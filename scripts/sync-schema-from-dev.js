#!/usr/bin/env node

/*
 * Sync MySQL + Mongo schema from dev environment to other environments.
 *
 * Non-destructive by design:
 * - MySQL: only adds missing tables/columns/indexes/foreign keys.
 * - Mongo: only adds missing collections/indexes.
 *
 * Usage examples:
 *   node scripts/sync-schema-from-dev.js
 *   node scripts/sync-schema-from-dev.js --targets=uat,prod
 *   node scripts/sync-schema-from-dev.js --dry-run
 *   node scripts/sync-schema-from-dev.js --mysql-only
 *   node scripts/sync-schema-from-dev.js --mongo-only
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const mongoose = require('mongoose');

const ENV_FILE_MAP = {
    dev: '.env.development',
    development: '.env.development',
    test: '.env.test',
    uat: '.env.uat',
    prod: '.env.production',
    production: '.env.production',
};

const CANONICAL_ENV_MAP = {
    dev: 'dev',
    development: 'dev',
    test: 'test',
    uat: 'uat',
    prod: 'production',
    production: 'production',
};

const DEFAULT_MYSQL_DB = {
    dev: 'library_booking_dev',
    test: 'library_booking_test',
    uat: 'library_booking_uat',
    production: 'library_booking',
};

const DEFAULT_MONGO_URI = {
    dev: 'mongodb://localhost:27017/library_booking_dev',
    test: 'mongodb://localhost:27017/library_booking_test',
    uat: 'mongodb://localhost:27017/library_booking_uat',
    production: 'mongodb://localhost:27017/library_booking',
};

const RETRYABLE_FK_ERROR_CODES = new Set([
    'ER_CANT_CREATE_TABLE',
    'ER_CANNOT_ADD_FOREIGN',
    'ER_FK_CANNOT_OPEN_PARENT',
]);

function getArgValue(args, name) {
    const prefix = `--${name}=`;
    const hit = args.find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
}

function hasArg(args, name) {
    return args.includes(`--${name}`);
}

function quoteId(identifier) {
    return `\`${String(identifier).replace(/`/g, '``')}\``;
}

function parseDotEnv(content) {
    const env = {};
    const lines = String(content || '').split(/\r?\n/);

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const idx = line.indexOf('=');
        if (idx <= 0) continue;

        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
}

function normalizeEnvName(name) {
    const key = String(name || '').trim().toLowerCase();
    return CANONICAL_ENV_MAP[key] || null;
}

function envFileFor(name) {
    const key = String(name || '').trim().toLowerCase();
    return ENV_FILE_MAP[key] || null;
}

function loadEnvFile(fileName) {
    const fullPath = path.join(__dirname, '..', fileName);
    if (!fs.existsSync(fullPath)) {
        return {};
    }
    return parseDotEnv(fs.readFileSync(fullPath, 'utf8'));
}

function loadEnvConfig(envName) {
    const canonical = normalizeEnvName(envName);
    if (!canonical) {
        throw new Error(`Unsupported environment name: ${envName}`);
    }

    const fileName = envFileFor(envName);
    const fileEnv = fileName ? loadEnvFile(fileName) : {};

    const mysqlConfig = {
        host: fileEnv.DB_MYSQL_HOST || process.env.DB_MYSQL_HOST || 'localhost',
        port: Number(
            fileEnv.DB_MYSQL_PORT || process.env.DB_MYSQL_PORT || 3306
        ),
        user: fileEnv.DB_MYSQL_USER || process.env.DB_MYSQL_USER || 'root',
        password:
            fileEnv.DB_MYSQL_PASSWORD || process.env.DB_MYSQL_PASSWORD || '',
        database:
            fileEnv.DB_MYSQL_DATABASE ||
            process.env.DB_MYSQL_DATABASE ||
            DEFAULT_MYSQL_DB[canonical],
    };

    const mongoUri =
        fileEnv.DB_MONGODB_URI ||
        process.env.DB_MONGODB_URI ||
        DEFAULT_MONGO_URI[canonical];

    return {
        canonical,
        fileName,
        mysql: mysqlConfig,
        mongoUri,
    };
}

function parseTargets(args) {
    const raw = getArgValue(args, 'targets');
    const defaults = ['test', 'uat', 'production'];

    const source = raw
        ? raw
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
        : defaults;

    const normalized = [];
    const seen = new Set();

    for (const item of source) {
        const canonical = normalizeEnvName(item);
        if (!canonical) {
            throw new Error(`Unsupported target environment: ${item}`);
        }
        if (canonical === 'dev') continue;
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        normalized.push(canonical);
    }

    return normalized;
}

function stripAutoIncrement(createSql) {
    return String(createSql || '').replace(/\sAUTO_INCREMENT=\d+/g, '');
}

function extractCreateParts(createSql) {
    const lines = String(createSql || '').split('\n');
    const columns = [];
    const indexes = [];
    const constraints = [];

    for (const raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith('CREATE TABLE')) continue;
        if (line.startsWith(')')) continue;

        if (line.endsWith(',')) {
            line = line.slice(0, -1);
        }

        if (line.startsWith('`')) {
            const match = line.match(/^`([^`]+)`\s+/);
            if (match) {
                columns.push({
                    name: match[1],
                    definition: line,
                });
            }
            continue;
        }

        if (/^(UNIQUE KEY|FULLTEXT KEY|SPATIAL KEY|KEY)\s+`/.test(line)) {
            const match = line.match(
                /^(?:UNIQUE KEY|FULLTEXT KEY|SPATIAL KEY|KEY)\s+`([^`]+)`/
            );
            if (match) {
                indexes.push({
                    name: match[1],
                    definition: line,
                });
            }
            continue;
        }

        if (line.startsWith('CONSTRAINT `')) {
            const match = line.match(/^CONSTRAINT\s+`([^`]+)`/);
            if (match) {
                constraints.push({
                    name: match[1],
                    definition: line,
                });
            }
        }
    }

    return { columns, indexes, constraints };
}

function isRetryableForeignKeyError(error) {
    if (!error) return false;
    if (RETRYABLE_FK_ERROR_CODES.has(error.code)) return true;
    return [1005, 1215, 1824].includes(Number(error.errno));
}

function isIgnorableAddError(error) {
    if (!error) return false;
    return (
        error.code === 'ER_DUP_FIELDNAME' ||
        error.code === 'ER_DUP_KEYNAME' ||
        error.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
        error.code === 'ER_FK_DUP_NAME'
    );
}

async function executeSql(connection, sql, dryRun) {
    if (dryRun) {
        console.log(`[dry-run] ${sql}`);
        return;
    }
    await connection.query(sql);
}

async function createMysqlConnection(config, withDatabase) {
    const connectionConfig = {
        host: config.host,
        port: Number(config.port),
        user: config.user,
        password: config.password,
    };

    if (withDatabase) {
        connectionConfig.database = config.database;
    }

    return mysql.createConnection(connectionConfig);
}

async function fetchDatabaseCharset(connection, dbName) {
    const sql = `
        SELECT
            DEFAULT_CHARACTER_SET_NAME AS charset,
            DEFAULT_COLLATION_NAME AS collation
        FROM information_schema.SCHEMATA
        WHERE SCHEMA_NAME = ?
        LIMIT 1
    `;
    const [rows] = await connection.query(sql, [dbName]);
    const hit = rows && rows[0];
    return {
        charset: (hit && hit.charset) || 'utf8mb4',
        collation: (hit && hit.collation) || 'utf8mb4_unicode_ci',
    };
}

async function fetchTableNames(connection, dbName) {
    const sql = `
        SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    `;
    const [rows] = await connection.query(sql, [dbName]);
    return (rows || []).map((row) => row.TABLE_NAME);
}

async function fetchShowCreateTable(connection, dbName, tableName) {
    const sql = `SHOW CREATE TABLE ${quoteId(dbName)}.${quoteId(tableName)}`;
    const [rows] = await connection.query(sql);
    const row = rows && rows[0];
    if (!row) {
        throw new Error(`SHOW CREATE TABLE returned empty for ${dbName}.${tableName}`);
    }
    const createSql =
        row['Create Table'] ||
        row['Create View'] ||
        row[Object.keys(row).find((key) => key.toLowerCase().includes('create'))];
    if (!createSql) {
        throw new Error(`Cannot parse CREATE TABLE SQL for ${dbName}.${tableName}`);
    }
    return createSql;
}

async function buildDevMySqlSnapshot(devConnection, devDbName) {
    const tables = await fetchTableNames(devConnection, devDbName);
    const tableMap = {};

    for (const table of tables) {
        const createSql = await fetchShowCreateTable(devConnection, devDbName, table);
        tableMap[table] = {
            createSql,
            parts: extractCreateParts(createSql),
        };
    }

    return {
        tables,
        tableMap,
    };
}

async function ensureTargetDatabase(serverConnection, targetDbName, charset, dryRun) {
    const sql = `CREATE DATABASE IF NOT EXISTS ${quoteId(targetDbName)} CHARACTER SET ${charset.charset} COLLATE ${charset.collation}`;
    await executeSql(serverConnection, sql, dryRun);
}

async function createMissingTables(targetConnection, targetDbName, devSnapshot, targetTableSet, dryRun) {
    let pending = devSnapshot.tables.filter((table) => !targetTableSet.has(table));
    if (!pending.length) return;

    console.log(`  [mysql] creating missing tables: ${pending.join(', ')}`);

    let progressed = true;
    while (pending.length && progressed) {
        progressed = false;
        const remaining = [];

        for (const table of pending) {
            const sourceSql = devSnapshot.tableMap[table].createSql;
            const createSql = stripAutoIncrement(sourceSql);
            try {
                await executeSql(targetConnection, createSql, dryRun);
                targetTableSet.add(table);
                progressed = true;
            } catch (error) {
                if (isRetryableForeignKeyError(error)) {
                    remaining.push(table);
                    continue;
                }
                throw error;
            }
        }

        pending = remaining;
    }

    if (pending.length) {
        throw new Error(
            `Unable to create tables due to unresolved dependencies: ${pending.join(', ')}`
        );
    }

    const refreshed = await fetchTableNames(targetConnection, targetDbName);
    targetTableSet.clear();
    refreshed.forEach((table) => targetTableSet.add(table));
}

async function syncMissingColumns(targetConnection, targetDbName, tableName, devParts, dryRun) {
    const targetCreateSql = await fetchShowCreateTable(targetConnection, targetDbName, tableName);
    const targetParts = extractCreateParts(targetCreateSql);
    const targetColumns = new Set(targetParts.columns.map((column) => column.name));
    let addedCount = 0;

    for (let idx = 0; idx < devParts.columns.length; idx += 1) {
        const devColumn = devParts.columns[idx];
        if (targetColumns.has(devColumn.name)) {
            continue;
        }

        let previousExistingColumn = null;
        for (let scan = idx - 1; scan >= 0; scan -= 1) {
            const candidate = devParts.columns[scan].name;
            if (targetColumns.has(candidate)) {
                previousExistingColumn = candidate;
                break;
            }
        }

        let sql = `ALTER TABLE ${quoteId(tableName)} ADD COLUMN ${devColumn.definition}`;
        if (previousExistingColumn) {
            sql += ` AFTER ${quoteId(previousExistingColumn)}`;
        }

        try {
            await executeSql(targetConnection, sql, dryRun);
            targetColumns.add(devColumn.name);
            addedCount += 1;
        } catch (error) {
            if (isIgnorableAddError(error)) {
                targetColumns.add(devColumn.name);
                continue;
            }
            throw error;
        }
    }

    return addedCount;
}

async function syncMissingIndexes(targetConnection, targetDbName, tableName, devParts, dryRun) {
    const targetCreateSql = await fetchShowCreateTable(targetConnection, targetDbName, tableName);
    const targetParts = extractCreateParts(targetCreateSql);
    const targetIndexNames = new Set(targetParts.indexes.map((index) => index.name));
    let addedCount = 0;

    for (const devIndex of devParts.indexes) {
        if (targetIndexNames.has(devIndex.name)) continue;

        const sql = `ALTER TABLE ${quoteId(tableName)} ADD ${devIndex.definition}`;
        try {
            await executeSql(targetConnection, sql, dryRun);
            targetIndexNames.add(devIndex.name);
            addedCount += 1;
        } catch (error) {
            if (isIgnorableAddError(error)) {
                targetIndexNames.add(devIndex.name);
                continue;
            }
            throw error;
        }
    }

    return addedCount;
}

async function syncMissingConstraints(targetConnection, targetDbName, devSnapshot, targetTableSet, dryRun) {
    const pending = [];

    for (const tableName of devSnapshot.tables) {
        if (!targetTableSet.has(tableName)) continue;

        const devParts = devSnapshot.tableMap[tableName].parts;
        if (!devParts.constraints.length) continue;

        const targetCreateSql = await fetchShowCreateTable(targetConnection, targetDbName, tableName);
        const targetParts = extractCreateParts(targetCreateSql);
        const targetConstraintNames = new Set(
            targetParts.constraints.map((constraint) => constraint.name)
        );

        for (const devConstraint of devParts.constraints) {
            if (!targetConstraintNames.has(devConstraint.name)) {
                pending.push({
                    tableName,
                    definition: devConstraint.definition,
                    name: devConstraint.name,
                });
            }
        }
    }

    if (!pending.length) return 0;

    let totalAdded = 0;
    let queue = pending;
    let progressed = true;

    while (queue.length && progressed) {
        progressed = false;
        const nextRound = [];

        for (const item of queue) {
            const sql = `ALTER TABLE ${quoteId(item.tableName)} ADD ${item.definition}`;
            try {
                await executeSql(targetConnection, sql, dryRun);
                totalAdded += 1;
                progressed = true;
            } catch (error) {
                if (isRetryableForeignKeyError(error) || isIgnorableAddError(error)) {
                    nextRound.push(item);
                    continue;
                }
                throw error;
            }
        }

        queue = nextRound;
    }

    if (queue.length) {
        const unresolved = queue.map((item) => `${item.tableName}.${item.name}`);
        throw new Error(
            `Unable to add foreign keys due to unresolved dependencies: ${unresolved.join(', ')}`
        );
    }

    return totalAdded;
}

async function syncMysqlFromDev(devConfig, targetConfigs, dryRun) {
    console.log('==== MySQL sync (dev -> targets) ====');

    const devConnection = await createMysqlConnection(devConfig.mysql, true);
    try {
        const charset = await fetchDatabaseCharset(
            devConnection,
            devConfig.mysql.database
        );
        const devSnapshot = await buildDevMySqlSnapshot(
            devConnection,
            devConfig.mysql.database
        );

        console.log(
            `  [mysql] source db: ${devConfig.mysql.database} (tables: ${devSnapshot.tables.length})`
        );

        for (const target of targetConfigs) {
            console.log(`\n  [mysql] target env: ${target.canonical}`);
            console.log(`  [mysql] target db: ${target.mysql.database}`);

            const serverConnection = await createMysqlConnection(target.mysql, false);
            try {
                await ensureTargetDatabase(
                    serverConnection,
                    target.mysql.database,
                    charset,
                    dryRun
                );
            } finally {
                await serverConnection.end();
            }

            const targetConnection = await createMysqlConnection(target.mysql, true);
            try {
                const targetTables = new Set(
                    await fetchTableNames(targetConnection, target.mysql.database)
                );

                await createMissingTables(
                    targetConnection,
                    target.mysql.database,
                    devSnapshot,
                    targetTables,
                    dryRun
                );

                let addedColumns = 0;
                let addedIndexes = 0;

                for (const tableName of devSnapshot.tables) {
                    if (!targetTables.has(tableName)) continue;
                    const devParts = devSnapshot.tableMap[tableName].parts;
                    addedColumns += await syncMissingColumns(
                        targetConnection,
                        target.mysql.database,
                        tableName,
                        devParts,
                        dryRun
                    );
                    addedIndexes += await syncMissingIndexes(
                        targetConnection,
                        target.mysql.database,
                        tableName,
                        devParts,
                        dryRun
                    );
                }

                const addedConstraints = await syncMissingConstraints(
                    targetConnection,
                    target.mysql.database,
                    devSnapshot,
                    targetTables,
                    dryRun
                );

                console.log(
                    `  [mysql] done: columns +${addedColumns}, indexes +${addedIndexes}, fks +${addedConstraints}`
                );
            } finally {
                await targetConnection.end();
            }
        }
    } finally {
        await devConnection.end();
    }
}

async function openMongoConnection(uri) {
    return mongoose
        .createConnection(uri, {
            autoIndex: false,
            serverSelectionTimeoutMS: 10000,
        })
        .asPromise();
}

function buildMongoIndexOptions(indexSpec) {
    const options = { name: indexSpec.name };
    const allowed = [
        'unique',
        'sparse',
        'expireAfterSeconds',
        'partialFilterExpression',
        'collation',
        'weights',
        'default_language',
        'language_override',
        'textIndexVersion',
        '2dsphereIndexVersion',
        'bits',
        'min',
        'max',
        'bucketSize',
        'wildcardProjection',
        'hidden',
    ];

    for (const key of allowed) {
        if (indexSpec[key] !== undefined) {
            options[key] = indexSpec[key];
        }
    }

    return options;
}

async function syncMongoFromDev(devConfig, targetConfigs, dryRun) {
    console.log('\n==== Mongo sync (dev -> targets) ====');

    const devConn = await openMongoConnection(devConfig.mongoUri);
    try {
        const devCollections = await devConn.db
            .listCollections({}, { nameOnly: true })
            .toArray();
        const devCollectionNames = devCollections
            .map((item) => item.name)
            .sort();

        const devIndexMap = {};
        for (const name of devCollectionNames) {
            devIndexMap[name] = await devConn.db.collection(name).indexes();
        }

        console.log(
            `  [mongo] source uri: ${devConfig.mongoUri} (collections: ${devCollectionNames.length})`
        );

        for (const target of targetConfigs) {
            console.log(`\n  [mongo] target env: ${target.canonical}`);
            console.log(`  [mongo] target uri: ${target.mongoUri}`);

            const targetConn = await openMongoConnection(target.mongoUri);
            try {
                const targetCollections = await targetConn.db
                    .listCollections({}, { nameOnly: true })
                    .toArray();
                const targetCollectionSet = new Set(
                    targetCollections.map((item) => item.name)
                );

                let addedCollections = 0;
                let addedIndexes = 0;

                for (const collectionName of devCollectionNames) {
                    let createdInThisRun = false;

                    if (!targetCollectionSet.has(collectionName)) {
                        if (dryRun) {
                            console.log(
                                `[dry-run] mongo.createCollection(${collectionName})`
                            );
                        } else {
                            await targetConn.db.createCollection(collectionName);
                        }
                        targetCollectionSet.add(collectionName);
                        createdInThisRun = true;
                        addedCollections += 1;
                    }

                    const devIndexes = devIndexMap[collectionName] || [];
                    let targetIndexNames;
                    if (dryRun && createdInThisRun) {
                        targetIndexNames = new Set(['_id_']);
                    } else {
                        const targetIndexes = await targetConn.db
                            .collection(collectionName)
                            .indexes();
                        targetIndexNames = new Set(
                            targetIndexes.map((item) => item.name)
                        );
                    }

                    for (const devIndex of devIndexes) {
                        if (!devIndex || devIndex.name === '_id_') continue;
                        if (targetIndexNames.has(devIndex.name)) continue;

                        const options = buildMongoIndexOptions(devIndex);

                        if (dryRun) {
                            console.log(
                                `[dry-run] mongo.createIndex(${collectionName}, ${JSON.stringify(
                                    devIndex.key
                                )}, ${JSON.stringify(options)})`
                            );
                        } else {
                            await targetConn.db
                                .collection(collectionName)
                                .createIndex(devIndex.key, options);
                        }

                        targetIndexNames.add(devIndex.name);
                        addedIndexes += 1;
                    }
                }

                console.log(
                    `  [mongo] done: collections +${addedCollections}, indexes +${addedIndexes}`
                );
            } finally {
                await targetConn.close();
            }
        }
    } finally {
        await devConn.close();
    }
}

async function main() {
    const args = process.argv.slice(2);

    const dryRun = hasArg(args, 'dry-run');
    const mysqlOnly = hasArg(args, 'mysql-only');
    const mongoOnly = hasArg(args, 'mongo-only');

    if (mysqlOnly && mongoOnly) {
        throw new Error('Cannot use --mysql-only and --mongo-only together.');
    }

    const targets = parseTargets(args);
    if (!targets.length) {
        console.log('No target environments to sync.');
        return;
    }

    const devConfig = loadEnvConfig('dev');
    const targetConfigs = targets.map((target) => loadEnvConfig(target));

    console.log('Schema sync options:');
    console.log(`  dryRun: ${dryRun}`);
    console.log(`  mysql: ${mongoOnly ? 'skip' : 'sync'}`);
    console.log(`  mongo: ${mysqlOnly ? 'skip' : 'sync'}`);
    console.log(`  targets: ${targets.join(', ')}`);

    if (!mongoOnly) {
        await syncMysqlFromDev(devConfig, targetConfigs, dryRun);
    }

    if (!mysqlOnly) {
        await syncMongoFromDev(devConfig, targetConfigs, dryRun);
    }

    console.log('\nSchema sync completed.');
}

main().catch((error) => {
    console.error('Schema sync failed:', error && error.stack ? error.stack : error);
    process.exit(1);
});
