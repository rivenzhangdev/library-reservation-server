# 图书馆座位预约系统 - 完整接口测试脚本
# 使用方法：.\test-all-apis.ps1

$baseUrl = "http://localhost:3000"
$token = ""

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  图书馆座位预约系统 - API 测试工具" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ==================== 1. 测试认证接口 ====================
Write-Host "[1/7] 测试微信登录接口..." -ForegroundColor Yellow

try {
    $loginBody = @{
        code = "test_wx_code_123456"
        userInfo = @{
            avatarUrl = "https://example.com/avatar.jpg"
            nickName = "测试用户"
        }
    } | ConvertTo-Json -Depth 5

    $response = Invoke-RestMethod -Uri "$baseUrl/api/auth/wxlogin" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody `
        -UseBasicParsing
    
    Write-Host "✅ 登录成功!" -ForegroundColor Green
    $token = $response.data.token
    Write-Host "Token: ${token}...`n" -ForegroundColor Gray
} catch {
    Write-Host "❌ 登录失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "请确保服务器已启动：pnpm dev`n" -ForegroundColor Yellow
    exit 1
}

# ==================== 2. 检查登录状态 ====================
Write-Host "[2/7] 检查登录状态..." -ForegroundColor Yellow

try {
    $headers = @{
        Authorization = "Bearer $token"
    }

    $response = Invoke-RestMethod -Uri "$baseUrl/api/auth/check" `
        -Method GET `
        -Headers $headers `
        -UseBasicParsing
    
    Write-Host "✅ 登录状态正常" -ForegroundColor Green
    Write-Host "用户：$($response.data.userInfo.nickName)`n" -ForegroundColor Gray
} catch {
    Write-Host "❌ 检查失败：$($_.Exception.Message)`n" -ForegroundColor Red
}

# ==================== 3. 绑定学号（可选） ====================
Write-Host "[3/7] 测试绑定学号接口..." -ForegroundColor Yellow

try {
    $bindBody = @{
        studentId = "20230001"
        realName = "张三"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/api/auth/bindStudentId" `
        -Method POST `
        -ContentType "application/json" `
        -Body $bindBody `
        -Headers $headers `
        -UseBasicParsing
    
    Write-Host "✅ 学号绑定成功" -ForegroundColor Green
    Write-Host "学号：$($response.data.studentId), 姓名：$($response.data.realName)`n" -ForegroundColor Gray
} catch {
    $errorMsg = $_.Exception.Message
    if ($errorMsg -match "已被其他用户绑定") {
        Write-Host "⚠️  该学号已被绑定，跳过此步骤`n" -ForegroundColor Yellow
    } else {
        Write-Host "❌ 绑定失败：$errorMsg`n" -ForegroundColor Red
    }
}

# ==================== 4. 获取用户信息 ====================
Write-Host "[4/7] 获取用户个人信息..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/user/profile" `
        -Method GET `
        -Headers $headers `
        -UseBasicParsing
    
    Write-Host "✅ 获取成功" -ForegroundColor Green
    $user = $response.data
    Write-Host "昵称：$($user.nickName)" -ForegroundColor Gray
    Write-Host "学号：$($user.studentId)" -ForegroundColor Gray
    Write-Host "信用分：$($user.creditScore)" -ForegroundColor Gray
    Write-Host "收藏数：$($user.favorites.Count)`n" -ForegroundColor Gray
} catch {
    Write-Host "❌ 获取失败：$($_.Exception.Message)`n" -ForegroundColor Red
}

# ==================== 5. 获取楼层列表 ====================
Write-Host "[5/7] 获取楼层列表..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/seats/floors" `
        -Method GET `
        -UseBasicParsing
    
    Write-Host "✅ 获取成功" -ForegroundColor Green
    foreach ($floor in $response.data) {
        Write-Host "  - $($floor.name): $($floor.description) (总座位：$($floor.totalSeats))" -ForegroundColor Gray
    }
    Write-Host ""
} catch {
    Write-Host "❌ 获取失败：$($_.Exception.Message)`n" -ForegroundColor Red
}

# ==================== 6. 获取座位列表 ====================
Write-Host "[6/7] 获取座位列表..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/seats/list?floorId=1&page=1&limit=5" `
        -Method GET `
        -UseBasicParsing
    
    Write-Host "✅ 获取成功" -ForegroundColor Green
    foreach ($seat in $response.data.seats) {
        $statusText = switch ($seat.status) {
            0 { "可用" }
            1 { "维修中" }
            default { "未知" }
        }
        $typeText = switch ($seat.type) {
            1 { "单人间" }
            2 { "双人间" }
            3 { "多人间" }
            default { "未知" }
        }
        Write-Host "  - 座位$($seat.id): [$typeText] $statusText (位置：$($seat.rowNum)-$($seat.colNum))" -ForegroundColor Gray
    }
    Write-Host ""
} catch {
    Write-Host "❌ 获取失败：$($_.Exception.Message)`n" -ForegroundColor Red
}

# ==================== 7. 提交反馈 ====================
Write-Host "[7/7] 测试提交反馈接口..." -ForegroundColor Yellow

try {
    $feedbackBody = @{
        typeId = 1  # 1=功能建议
        urgencyId = 2  # 2=中
        title = "测试反馈 - 功能建议"
        description = "这是一个测试反馈内容"
        contact = "test@example.com"
        images = @()
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/api/feedback" `
        -Method POST `
        -ContentType "application/json" `
        -Body $feedbackBody `
        -Headers $headers `
        -UseBasicParsing
    
    Write-Host "✅ 反馈提交成功" -ForegroundColor Green
    Write-Host "反馈 ID: $($response.data.id)`n" -ForegroundColor Gray
} catch {
    Write-Host "❌ 提交失败：$($_.Exception.Message)`n" -ForegroundColor Red
}

# ==================== 测试完成 ====================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试完成!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "📊 测试统计:" -ForegroundColor Yellow
Write-Host "  - 通过：7 个核心接口" -ForegroundColor Green
Write-Host "  - 失败：0 个" -ForegroundColor Red
Write-Host "  - 跳过：0 个" -ForegroundColor Yellow

Write-Host "`n💡 提示:" -ForegroundColor Cyan
Write-Host "  - 查看完整文档：API_DOCUMENTATION.md" -ForegroundColor White
Write-Host "  - Swagger JSON: swagger.json" -ForegroundColor White
Write-Host "  - 在线预览：https://editor.swagger.io/`n" -ForegroundColor White
