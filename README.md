# 🚗 Tessie MCP Server - Tesla Intelligence Platform

[![smithery badge](https://smithery.ai/badge/@keithah/tessie-mcp)](https://smithery.ai/server/@keithah/tessie-mcp)

Transform your Tesla ownership experience with intelligent insights, cost optimization, and predictive analytics through the [Tessie API](https://tessie.com). From basic vehicle data to comprehensive financial analysis and commute optimization - this is the most advanced Tesla MCP server available.

## 🆕 What's New in v1.2.0

- **📊 Efficiency Trends Analysis** - Weekly/monthly/seasonal efficiency tracking with weather & speed impact
- **🔌 Smart Charging Reminders** - Intelligent charging optimization with time-of-use cost savings
- **🛡️ Enhanced Error Handling** - Robust retry logic with graceful degradation for vehicle sleep/offline states
- **⚡ Improved FSD Detection** - Removed reliance on broken autopilot_distance API field
- **🎯 Production Ready** - Comprehensive error classification with user-friendly messages

## ✨ Key Features

### 💰 Financial Intelligence
- **Smart Charging Cost Analysis** - Track home vs Supercharger vs public charging costs
- **Trip Cost Optimization** - Calculate real trip costs with gas vehicle comparisons
- **Money-Saving Recommendations** - "Shift to off-peak charging to save $45/month"
- **Environmental Impact Tracking** - CO2 savings and tree-planting equivalents

### 🧠 Predictive Analytics
- **Commute Pattern Detection** - Auto-identify regular routes (home ↔ work)
- **Efficiency Trend Analysis** - Track route performance over time
- **FSD Usage Estimation** - Predict autopilot usage from driving patterns
- **Future Trip Planning** - Cost estimates and charging strategy for upcoming trips

### 📊 Advanced Insights
- **Efficiency Trends** - Weekly/monthly/seasonal efficiency analysis with confidence scoring
- **Weather Impact Analysis** - Hot/cold weather penalties with optimization tips
- **Speed Factor Analysis** - Highway vs city efficiency with optimal speed recommendations
- **Smart Charging Reminders** - Priority-based alerts with cost savings calculations
- **Time Pattern Detection** - Best/worst days and times for efficient driving
- **Route Optimization** - "Your Santa Rosa commute efficiency is declining 📉"
- **Charging Strategy** - Optimal departure battery levels and time-of-use scheduling
- **Weekly/Monthly Summaries** - Comprehensive ownership analytics with actionable insights

### 🚗 Complete Tesla Data Access
- **Real-time Vehicle State** - Battery, location, climate, locks, speed
- **Historical Driving Data** - Trips, mileage, efficiency, routes
- **Charging Analytics** - Sessions, costs, locations, optimization
- **Smart VIN Resolution** - Automatically detects your active vehicle

### 🛡️ Production-Ready Reliability
- **Intelligent Error Handling** - Automatic retry with exponential backoff
- **Graceful Degradation** - Fallback responses when vehicle is asleep/offline
- **Rate Limit Respect** - Smart handling of Tessie API limits with retry-after
- **Network Resilience** - Robust handling of timeouts and connectivity issues
- **User-Friendly Errors** - Clear explanations with actionable troubleshooting tips
- **Context-Aware Responses** - Different retry strategies for real-time vs historical data

## Installation

### Installing via Smithery

To install tessie-mcp automatically via [Smithery](https://smithery.ai/server/@keithah/tessie-mcp):

```bash
npx -y @smithery/cli install @keithah/tessie-mcp
```

### Prerequisites

- [Claude Desktop](https://claude.ai/download) v0.10.0 or later
- A [Tessie](https://tessie.com) account with API access
- Your Tessie API token from https://tessie.com

### Install the Extension

1. Download the `tessie.mcpb` file from this repository
2. Double-click the `.mcpb` file to install it in Claude Desktop
3. Enable the extension in Claude Desktop settings
4. Configure your Tessie API token when prompted

### Upgrading

To upgrade to a newer version:

1. Download the latest `tessie.mcpb` file from the [GitHub releases page](https://github.com/keithah/tessie-mcp/releases)
2. Double-click the new `.mcpb` file - it will automatically replace the old version
3. Restart Claude Desktop to ensure the new version loads

No need to uninstall the old version first - the MCPB installer handles upgrades automatically.

### Configuration

The extension requires your Tessie API token to function. You can get your token from:
1. Log into your Tessie account at https://tessie.com
2. Navigate to your API settings
3. Copy your API token
4. Enter it in the Claude Desktop extension configuration

## 🛠️ Available Tools

### 🚗 Vehicle Information & Status
- **get_vehicles** - List all vehicles in your Tessie account
- **get_vehicle_current_state** - Get comprehensive vehicle status with location address
- **get_driving_history** - Get driving history and trip data
- **get_weekly_mileage** - Calculate total miles driven in a specific period

### 💰 Financial & Cost Analysis
- **analyze_charging_costs** - Comprehensive charging cost analysis by location type
- **calculate_trip_cost** - Calculate cost and environmental impact of completed trips
- **estimate_future_trip** - Plan charging strategy and costs for upcoming trips

### 🧠 Intelligence & Analytics
- **analyze_latest_drive** - Detailed analysis of recent drive with FSD prediction
- **analyze_commute_patterns** - Detect regular routes with efficiency trends
- **analyze_efficiency_trends** - Comprehensive efficiency analysis with weather/speed/time factors
- **get_smart_charging_reminders** - Intelligent charging optimization with cost savings
- **natural_language_query** - Process natural language queries about vehicle data

### 🔋 Battery & Charging
- **Smart charging cost tracking** with home vs Supercharger vs public analysis
- **Money-saving recommendations** based on usage patterns
- **Time-of-use optimization** for peak/off-peak charging rates

### 📍 Location & Navigation
- **Automatic address resolution** from GPS coordinates
- **Route pattern recognition** for commute detection
- **Distance and efficiency calculations** between locations

### 🤖 Predictive FSD Detection
- **Highway speed consistency analysis** for autopilot estimation
- **Route-based FSD probability** using driving patterns
- **Efficiency comparison** between predicted FSD and manual driving

## 💬 Example Commands

### 🚗 Vehicle Status & Location
```
"What's my Tesla's current battery level?"
"Where is my car parked right now?"
"Show me my vehicle status"
"Is my Tesla locked?"
"What's the climate temperature?"
```

### 💰 Cost Analysis & Optimization
```
"How much did I spend on charging last month?"
"Analyze my charging costs by location"
"Calculate the cost of my trip to Santa Rosa"
"How much money am I saving vs a gas car?"
"Show me my Supercharger vs home charging breakdown"
```

### 🗺️ Trip Planning & Analysis
```
"Estimate the cost for a 300-mile trip with 65% battery"
"Analyze my latest drive"
"How efficient was my commute this week?"
"Plan charging stops for my trip to Los Angeles"
```

### 🛣️ Commute & Route Intelligence
```
"Detect my regular commute patterns"
"Which of my routes is most efficient?"
"Show me my weekly driving patterns"
"How much do my commutes cost per week?"
"Is my route efficiency improving or declining?"
```

### 🤖 FSD & Autopilot Analysis
```
"How much autopilot did I use this week?"
"Analyze my FSD usage patterns"
"Compare my manual vs autopilot efficiency"
"What percentage of my highway driving was on FSD?"
```

### 📊 Advanced Analytics & Efficiency
```
"Analyze my driving efficiency trends over the past 6 weeks"
"Show me how weather affects my Tesla's efficiency"
"Which days of the week am I most efficient?"
"Compare my highway vs city driving efficiency"
"What are my efficiency trends - improving or declining?"
```

### 🔌 Smart Charging & Optimization
```
"Give me smart charging reminders for tonight"
"Should I charge now or wait for off-peak hours?"
"What's my optimal charging schedule this week?"
"How much can I save with better charging timing?"
"Check if I need to charge before my 200-mile trip tomorrow"
```

### 📊 Comprehensive Analytics
```
"Give me a comprehensive monthly summary"
"What are my most expensive charging locations?"
"Compare this month's efficiency to last month"
"Show me my driving patterns and optimization tips"
```

Claude will automatically use the appropriate Tessie tools to get the information you need.

## Smart VIN Resolution

The extension automatically handles vehicle identification:

- **Single Active Vehicle**: If you have one active Tesla, it's used automatically
- **Multiple Vehicles**: If you have multiple active vehicles, you'll be prompted to choose
- **No Active Vehicles**: Clear error messages if no vehicles are available

## Experimental FSD Detection

**⚠️ Important Disclaimer**: The FSD detection feature is experimental and provides **estimates only**. It is not verified by Tesla or Tessie and should not be considered accurate for official purposes.

### How It Works

The extension analyzes driving patterns to estimate when Full Self-Driving might have been active:

- **Speed Consistency**: FSD maintains very consistent speeds, especially on highways
- **Heading Smoothness**: FSD produces smooth, predictable steering patterns  
- **Route Characteristics**: FSD is more commonly used on highways and longer trips
- **Duration Analysis**: FSD usage typically correlates with longer drive segments

### Confidence Scoring

Each analysis receives a confidence score (0-100%):
- **80-100**: Very High - Strong FSD-like patterns detected
- **60-79**: High - Likely FSD usage based on multiple indicators
- **40-59**: Moderate - Mixed signals, uncertain
- **20-39**: Low - Likely manual driving
- **0-19**: Very Low - Manual driving patterns

### Limitations

- **No Ground Truth**: Tesla doesn't provide official FSD usage data
- **Pattern-Based Only**: Analysis relies on driving patterns, not direct FSD status
- **Individual Variation**: Driving styles vary; what looks like FSD for one person might be manual for another
- **External Factors**: Weather, traffic, and road conditions can affect patterns
- **Experimental Feature**: This is a research tool, not a definitive measurement

Use FSD detection results for personal analysis and insights, but don't rely on them for anything requiring precision.

## API Coverage

This extension implements all GET endpoints under "Vehicle Data" from the official [Tessie API documentation](https://developer.tessie.com/reference/about):

- All vehicle information endpoints
- Complete battery and charging data
- Full location and driving history
- Climate and weather information
- Vehicle configuration and settings
- Service and alert data
- Tire pressure and consumption metrics

## Security

- API tokens are stored securely in Claude Desktop's configuration
- No hardcoded credentials in the extension code
- All API communication uses HTTPS
- Tokens are passed via environment variables

## Requirements

- **Node.js**: v18.0.0 or later
- **Claude Desktop**: v0.10.0 or later  
- **Platforms**: macOS, Windows, Linux
- **Tessie Account**: Active subscription with API access

## Troubleshooting

### Extension Not Running
- Check that you've enabled the extension in Claude Desktop settings
- Verify your Tessie API token is correctly configured
- Try disabling and re-enabling the extension

### API Errors
- Ensure your Tessie API token is valid and hasn't expired
- Check that your Tesla is connected to Tessie
- Verify your Tesla is awake (some operations require the vehicle to be active)

### No Vehicles Found
- Make sure your Tesla is linked to your Tessie account
- Check that the vehicle status shows as "active" in Tessie
- Try refreshing your vehicle connection in Tessie

## Development

The extension is built as a Node.js MCP (Model Context Protocol) server with:

- **TessieClient**: Handles all API communication with Tessie
- **TessieMCPServer**: Implements the MCP protocol for Claude Desktop
- **Smart Error Handling**: Comprehensive error messages and fallbacks
- **Zero Dependencies**: No external npm packages required

## License

MIT License - see LICENSE file for details.

## Support

For issues with the extension:
1. Check the troubleshooting section above
2. Verify your Tessie account and API token
3. Check Claude Desktop logs for detailed error messages

For Tessie API questions, visit the [official Tessie documentation](https://developer.tessie.com/).

---

**Note**: This extension requires a Tessie account and active API access. Tessie is a third-party service that provides enhanced Tesla vehicle data access. Visit [tessie.com](https://tessie.com) to learn more.
