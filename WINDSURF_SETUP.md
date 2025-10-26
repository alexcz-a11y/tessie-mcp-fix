# Windsurf IDE 配置指南

## 📍 配置文件位置

Windsurf 的 MCP 配置文件位于：
```
~/.codeium/windsurf/mcp_config.json
```

## 🚀 快速配置

### 方法 1：通过 Windsurf UI（推荐）

1. 打开 Windsurf IDE
2. 点击右上角的 **Plugins** 图标（或进入 `Windsurf Settings` > `Cascade` > `Plugins`）
3. 点击 **View Raw Config** 按钮
4. 将下面的配置粘贴到 `mcp_config.json` 文件中

### 方法 2：手动编辑配置文件

```bash
# 备份现有配置（如果存在）
cp ~/.codeium/windsurf/mcp_config.json ~/.codeium/windsurf/mcp_config.json.backup

# 编辑配置文件
nano ~/.codeium/windsurf/mcp_config.json
```

## 📝 完整配置（Tessie + Jina）

将以下内容复制到 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "tessie-mcp-fixed": {
      "command": "node",
      "args": [
        "/Users/alexnear/Documents/tessie-mcp/tessiemcp-fix/tessie-mcp-fix/.smithery/stdio/index.cjs",
        "apiKey=PL3jMQCGMk02SIHziqwpegeZj3YWEsD6"
      ],
      "env": {}
    },
    "jina-mcp-server": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.jina.ai/sse",
        "--header",
        "Authorization: Bearer jina_6392e539f48d4c4f9fbfe43f5c6dd9f9wYdm5RDgvKSCxwn05nnurzUGwKN9"
      ],
      "env": {}
    }
  }
}
```

## 🔧 配置说明

### Tessie MCP Server (修复版)

**功能：** Tesla 车辆数据查询和分析

**可用工具：**
- `get_vehicles` - 获取车辆列表
- `get_vehicle_current_state` - 获取当前车辆状态
- `get_tire_pressure` - 🆕 查询胎压状态
- `get_driving_history` - 获取驾驶历史
- `get_weekly_mileage` - 计算周里程
- `analyze_latest_drive` - 分析最近行程
- `analyze_charging_costs` - 分析充电成本
- `calculate_trip_cost` - 计算行程成本
- `estimate_future_trip` - 估算未来行程
- `analyze_commute_patterns` - 分析通勤模式
- `analyze_efficiency_trends` - 分析效率趋势
- `get_smart_charging_reminders` - 智能充电提醒
- `natural_language_query` - 自然语言查询

**配置参数：**
- `command`: `node` - 使用 Node.js 运行
- `args[0]`: MCP 服务器的完整路径
- `args[1]`: Tessie API Key（格式：`apiKey=YOUR_KEY`）

### Jina MCP Server

**功能：** 网络搜索、内容提取、图片搜索等

**可用工具：**
- `search_web` - 网络搜索
- `read_url` - 读取网页内容
- `search_images` - 图片搜索
- `search_arxiv` - 学术论文搜索
- `capture_screenshot_url` - 网页截图
- `sort_by_relevance` - 内容相关性排序
- `deduplicate_strings` - 文本去重
- `expand_query` - 查询扩展
- 更多工具...

**配置参数：**
- `command`: `npx` - 使用 npx 运行
- `args`: 连接到 Jina MCP 远程服务器
- 包含 Authorization Bearer Token

## ✅ 验证配置

配置完成后：

1. **重启 Windsurf IDE** 或刷新 MCP 连接
2. 在 Cascade 面板中，你应该能看到两个新的 MCP 服务器
3. 测试 Tessie 功能：
   ```
   检查我的胎压状态
   ```
4. 测试 Jina 功能：
   ```
   搜索最新的 Tesla Model 3 新闻
   ```

## 🎯 使用示例

### Tessie 查询示例

```
# 基础查询
- "我的电池电量是多少？"
- "检查我的胎压"
- "上周我开了多少英里？"
- "分析我最近的行程"

# 高级分析
- "分析我的充电成本"
- "我的通勤模式是什么？"
- "给我智能充电建议"
```

### Jina 查询示例

```
# 网络搜索
- "搜索 Tesla FSD 最新更新"
- "查找电动车充电站优化策略"

# 内容提取
- "读取这个网页的内容：https://..."
- "总结这篇文章的要点"

# 学术搜索
- "搜索关于电动车电池效率的论文"
```

## 🔒 安全提示

1. **API Key 保护**：配置文件包含敏感的 API Key，请勿分享
2. **文件权限**：确保配置文件权限正确
   ```bash
   chmod 600 ~/.codeium/windsurf/mcp_config.json
   ```
3. **备份配置**：定期备份你的配置文件

## 🐛 故障排除

### MCP 服务器无法连接

1. 检查配置文件路径是否正确
2. 确认 Node.js 已安装：`node --version`
3. 验证 Tessie MCP 构建文件存在：
   ```bash
   ls -la /Users/alexnear/Documents/tessie-mcp/tessiemcp-fix/tessie-mcp-fix/.smithery/stdio/index.cjs
   ```

### API Key 错误

1. 确认 Tessie API Key 有效
2. 检查 Jina Bearer Token 是否正确
3. 查看 Windsurf 的 MCP 日志

### 工具限制

- Windsurf 限制每次最多 100 个工具
- 如果工具太多，可以在 Plugins 设置中禁用不需要的工具

## 📚 相关文档

- [Windsurf MCP 官方文档](https://docs.windsurf.com/windsurf/cascade/mcp)
- [Model Context Protocol 规范](https://modelcontextprotocol.io/)
- [Tessie API 文档](https://developer.tessie.com/)
- [Jina MCP Server](https://mcp.jina.ai/)

## 🆕 更新日志

**v1.2.3** (2025-10-26)
- ✨ 新增胎压查询功能 (`get_tire_pressure`)
- 🔧 优化错误处理
- 📝 完善 Windsurf 配置文档

---

**配置完成后，重启 Windsurf 即可开始使用！** 🎉
