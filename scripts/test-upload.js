#!/usr/bin/env node
const axios = require('axios');

const baseUrl = process.env.BASE_URL || process.argv[2] || 'http://localhost:3000';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
const dataUrl = `data:image/png;base64,${tinyPngBase64}`;

async function run() {
  try {
    console.log(`Posting upload to ${baseUrl}/api/uploads`);
    const res = await axios.post(`${baseUrl}/api/uploads`, { dataUrl }, { timeout: 10000 });
    if (!res.data || res.data.success === false) {
      console.error('Upload API returned failure', res.data);
      process.exitCode = 2;
      return;
    }
    const url = res.data?.data?.url;
    console.log('Upload succeeded, url:', url);

    // Try to fetch the uploaded file
    const fetchUrl = `${baseUrl}${url}`;
    console.log('Fetching uploaded file:', fetchUrl);
    const getRes = await axios.get(fetchUrl, { responseType: 'arraybuffer', timeout: 10000 });
    if (getRes.status === 200) {
      console.log('Fetched uploaded file successfully, size:', getRes.data.length);
      process.exitCode = 0;
    } else {
      console.error('Failed to fetch uploaded file, status:', getRes.status);
      process.exitCode = 3;
    }
  } catch (err) {
    console.error('Test failed:', err.message || err);
    process.exitCode = 1;
  }
}

run();
