# Smithery configSchema 分析报告

## 🎯 核心问题

**Q: Tessie MCP 配置文件中的 AI 参数（modelName, temperature）是给 Smithery.ai 使用的吗？**

**A: 不是。这些参数是从 Smithery 官方文档示例直接复制过来的，并非 Smithery 平台的要求。**

---

## 📚 证据对比

### Smithery 官方文档示例
来源：https://smithery.ai/docs/build/session-config

```typescript
// Configuration schema - automatically detected by Smithery
export const configSchema = z.object({ 
  apiKey: z.string().describe("Your API key"), 
  modelName: z.string().default("gpt-4").describe("Model to use"), 
  temperature: z.number().min(0).max(1).default(0.7).describe("Temperature setting"), 
});

export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {
  const server = new McpServer({
    name: "My Server",
    version: "1.0.0",
  });

  // Use config values in your tools
  console.log(`Using model: ${config.modelName}`);
  
  return server.server;
}
```

### Tessie MCP 实际代码
来源：https://github.com/keithah/tessie-mcp/blob/main/src/index.ts

```typescript
// Configuration schema - automatically detected by Smithery
export const configSchema = z.object({
  apiKey: z.string().describe("Your API key"),
  modelName: z.string().default("gpt-4").describe("Model to use"),
  temperature: z.number().min(0).max(1).default(0.7).describe("Temperature setting"),
});

export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {
  const server = new McpServer({
    name: "tessie-mcp-server",
    title: "Tessie Vehicle Data",
    version: "1.1.1"
  });

  // Use config values in your tools
  console.log(`Using model: ${config.modelName}`);

  // Initialize clients
  const apiToken = config.apiKey;
  
  // ... 之后再也没有使用 config.modelName 或 config.temperature
}
```

### 对比结果

| 项目 | Smithery 文档 | Tessie MCP | 结论 |
|------|--------------|-----------|------|
| **configSchema 定义** | ✅ 完全相同 | ✅ 完全相同 | 直接复制 |
| **注释内容** | "automatically detected by Smithery" | "automatically detected by Smithery" | 连注释都一样 |
| **console.log 语句** | ✅ 有 | ✅ 有 | 完全相同 |
| **实际使用 modelName** | ❌ 示例代码 | ❌ 从未使用 | 都没用 |
| **实际使用 temperature** | ❌ 示例代码 | ❌ 从未使用 | 都没用 |
| **实际使用 apiKey** | ❌ 示例代码 | ✅ 用于 Tessie API | 唯一有用的字段 |

---

## 🔍 Smithery configSchema 的真实用途

根据 Smithery 官方文档（https://smithery.ai/docs/build/session-config），`configSchema` 的作用是：

### 1. 自动生成配置表单
```typescript
export const configSchema = z.object({
  apiKey: z.string().describe("Your API key"),
  units: z.string().default("celsius").describe("Temperature units"),
  maxResults: z.number().default(5).describe("Max results")
});
```

Smithery 会自动：
- 生成带有文本框、下拉菜单、数字输入框的 UI
- 显示 `describe()` 中的描述作为标签和提示
- 应用默认值和验证规则

### 2. 会话级配置
- 每个用户连接可以有不同的配置
- 配置在连接时绑定，不能中途更改
- 适合传递 API keys、用户偏好等

### 3. 完全自定义
开发者可以定义**任何字段**，例如：

```typescript
// 天气服务器的配置
export const configSchema = z.object({
  weatherApiKey: z.string(),
  defaultCity: z.string().default("London"),
  units: z.enum(["celsius", "fahrenheit"])
});

// 数据库服务器的配置
export const configSchema = z.object({
  dbHost: z.string(),
  dbPort: z.number().default(5432),
  dbName: z.string()
});

// 或者根本不需要配置
// 直接省略 configSchema 的导出即可
```

### 4. 不是 Smithery 的必需字段
- ❌ `modelName` 不是 Smithery 要求的
- ❌ `temperature` 不是 Smithery 要求的
- ❌ 甚至 `apiKey` 也不是必需的（如果你的服务不需要认证）

---

## 💡 为什么会有这些 AI 参数？

### 原因分析

1. **Smithery 文档使用 AI 参数作为示例**
   - 因为很多 MCP 服务器确实会调用 LLM
   - 这是一个通用的、容易理解的示例
   - 展示了如何配置字符串、数字、默认值等

2. **Tessie MCP 作者复制了示例代码**
   - 从文档复制了完整的 `configSchema` 示例
   - 只修改了服务器名称和版本号
   - 保留了所有示例字段，包括不需要的 AI 参数

3. **忘记删除无用的字段**
   - 实际只需要 `apiKey` 字段（用于 Tessie API）
   - `modelName` 和 `temperature` 从未被使用
   - 只在启动时打印了一下就再也没用过

### 类似的例子

这就像你从 Stack Overflow 复制代码时：
```python
# 你只需要读取文件
with open('file.txt', 'r') as f:
    data = f.read()

# 但你复制的示例代码还包含了：
import os
import sys
import json  # 你根本不需要这些
import datetime
```

---

## ✅ 正确的 Tessie MCP 配置应该是

```typescript
// 只需要 Tessie API token
export const configSchema = z.object({
  apiKey: z.string().describe("Your Tessie API token from tessie.com"),
});

export default function createServer({ config }: { config: z.infer<typeof configSchema> }) {
  const server = new McpServer({
    name: "tessie-mcp-server",
    title: "Tessie Vehicle Data",
    version: "1.1.1"
  });

  // 只使用 apiKey
  const tessieClient = new TessieClient(config.apiKey);
  
  // 不需要 modelName 和 temperature
  
  return server.server;
}
```

---

## 📊 总结表

| 问题 | 答案 |
|------|------|
| **AI 参数是 Smithery 要求的吗？** | ❌ 不是 |
| **AI 参数有什么用？** | ❌ 完全没用，从未被使用 |
| **为什么会有这些参数？** | ✅ 从 Smithery 文档示例复制的 |
| **Smithery 需要特定的配置字段吗？** | ❌ 不需要，完全自定义 |
| **configSchema 的真实用途是什么？** | ✅ 生成用户配置表单 |
| **Tessie MCP 实际需要什么配置？** | ✅ 只需要 `apiKey`（Tessie API token） |
| **应该删除 AI 参数吗？** | ✅ 是的，它们是多余的 |

---

## 🎓 学到的教训

1. **不要盲目复制示例代码**
   - 理解每个字段的用途
   - 删除不需要的部分
   - 根据实际需求定制

2. **Smithery configSchema 是灵活的**
   - 不是固定的模板
   - 可以定义任何字段
   - 根据你的服务需求设计

3. **文档示例只是示例**
   - 示例代码展示功能，不是最佳实践
   - 需要根据实际场景调整
   - 不要假设示例中的所有内容都是必需的

---

## 📚 参考资料

- **Smithery 配置文档**: https://smithery.ai/docs/build/session-config
- **Tessie MCP 源代码**: https://github.com/keithah/tessie-mcp
- **MCP 协议规范**: https://modelcontextprotocol.io/

---

**分析完成时间**: 2025-10-26  
**结论置信度**: 100%（基于官方文档和源代码对比）
