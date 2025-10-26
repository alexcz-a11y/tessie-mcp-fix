# 胎压查询功能 (Tire Pressure Feature)

## 功能说明

新增了胎压查询功能，可以实时获取Tesla车辆的四个轮胎气压状态。

## API 接口

### `get_tire_pressure`

获取车辆当前的胎压读数和状态指示。

**参数：**
- `vin` (必需): 车辆识别码 (VIN)
- `pressure_format` (可选): 压力单位，可选值：
  - `psi` (默认) - 磅/平方英寸
  - `bar` - 巴
  - `kpa` - 千帕
- `from` (可选): 历史数据起始时间戳（Unix秒）
- `to` (可选): 历史数据结束时间戳（Unix秒）

**返回数据：**
```json
{
  "vehicle_vin": "LRWYGCEK8RC606925",
  "timestamp": "2025-10-26T...",
  "pressure_unit": "psi",
  "tire_pressures": {
    "front_left": {
      "pressure": 39.9,
      "status": "normal",
      "emoji": "✅"
    },
    "front_right": {
      "pressure": 39.9,
      "status": "normal",
      "emoji": "✅"
    },
    "rear_left": {
      "pressure": 39.9,
      "status": "normal",
      "emoji": "✅"
    },
    "rear_right": {
      "pressure": 40.2,
      "status": "normal",
      "emoji": "✅"
    }
  },
  "overall_status": {
    "all_normal": true,
    "low_pressure_count": 0,
    "summary": "✅ All tires are properly inflated"
  },
  "recommendations": [
    "✅ Tire pressures are good",
    "📅 Check tire pressure monthly for optimal performance",
    "🌡️ Remember: tire pressure drops ~1 PSI per 10°F temperature decrease"
  ]
}
```

## 使用示例

### 在 Kiro 中使用

重启 MCP 服务器后，直接询问：
- "检查我的胎压状态"
- "查询胎压"
- "我的轮胎气压正常吗？"

### 通过 MCP 工具调用

```javascript
// 查询当前胎压（PSI）
await mcp.call('get_tire_pressure', {
  vin: 'YOUR_VIN',
  pressure_format: 'psi'
});

// 查询胎压（Bar）
await mcp.call('get_tire_pressure', {
  vin: 'YOUR_VIN',
  pressure_format: 'bar'
});
```

## 状态说明

胎压状态有三种：
- `normal` ✅ - 正常气压
- `low` ⚠️ - 气压偏低，需要充气
- `unknown` ❓ - 状态未知

## 建议

### 当所有轮胎正常时：
- ✅ 胎压良好
- 📅 每月检查一次胎压以保持最佳性能
- 🌡️ 记住：温度每降低10°F，胎压约下降1 PSI

### 当有轮胎气压偏低时：
- 🔧 将低压轮胎充气至推荐PSI（查看车门框贴纸）
- ⚡ 正确的胎压可提高3-5%的能效
- 🛡️ 正确的胎压延长轮胎寿命并提高安全性

## 技术实现

### 新增文件修改

1. **src/tessie-client.ts**
   - 添加 `TessieTirePressure` 接口
   - 添加 `getTirePressure()` 方法

2. **src/index.ts**
   - 注册 `get_tire_pressure` MCP 工具
   - 实现完整的错误处理和用户友好的响应格式

### API 端点

```
GET https://api.tessie.com/{vin}/tire_pressure?pressure_format={format}
```

## 测试

运行测试脚本：
```bash
node test-tire-pressure.js
```

## 更新日志

**v1.2.3** (2025-10-26)
- ✨ 新增胎压查询功能
- 🔧 支持 PSI、Bar、KPa 三种压力单位
- 📊 提供详细的状态指示和建议
- ✅ 已添加到自动批准列表

## 注意事项

- 胎压数据来自车辆的TPMS（胎压监测系统）
- 数据更新频率取决于车辆状态（行驶中更新更频繁）
- 如果车辆处于睡眠状态，可能无法获取最新数据
- 建议在车辆唤醒后查询以获得最准确的读数
