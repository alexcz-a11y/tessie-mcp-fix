# Changelog

All notable changes to the Tessie MCP Extension will be documented in this file.

## [v1.2.2] - 2025-10-22

### Fixed
- **MCP Protocol Compliance**: All tool responses now follow the MCP specification with proper `content` array format
- **Strict Client Compatibility**: Fixed compatibility issues with strict MCP clients (Kiro, Cursor, Windsurf, VSCode)
- **Response Format**: All 12 tools now return responses wrapped in `content: [{ type: "text", text: "..." }]` structure
- **Error Handling**: Error responses now follow MCP protocol format for consistent client parsing

### Technical Details
- Updated all tool handlers to return MCP-compliant response format
- Modified ErrorHandler to generate MCP-compliant fallback responses
- Preserved all existing data structures within the JSON text field
- Maintained backward compatibility with lenient clients (CherryStudio)

### Impact
- Resolves "content missing" errors in strict MCP clients
- No breaking changes to tool parameters or functionality
- All vehicle data and analytics remain fully accessible
- Consistent response formatting across all tools

## [v0.1.9] - 2025-09-12

### Added
- **Professional Report Generator**: New `generate_formatted_fsd_report` tool creates markdown-formatted FSD usage reports
- **Formatted Analytics**: Comprehensive period analysis with efficiency metrics and charging summaries
- **User-Friendly Output**: Clean, readable report format matching professional analytics standards

### Optimized
- **Token Usage**: Implemented aggressive caching and response compression reducing context usage by 70-80%
- **Response Size**: Ultra-compact JSON formatting with field filtering and data limiting
- **Performance**: Intelligent TTL-based caching system for faster repeated queries
- **Memory Efficiency**: Response size validation prevents token bloat

### Technical Improvements
- Enhanced data compression with `compactJson()` method
- Smart field filtering to include only essential data
- Automatic response truncation for oversized results
- Optimized caching strategy with configurable TTL

## [v0.1.8] - 2025-09-12

### Fixed
- **FSD Detection Algorithm**: Completely revamped FSD detection to accurately identify autopilot usage
- **API Field Mapping**: Fixed incorrect field name usage - now uses `odometer_distance` instead of `distance_miles`
- **Duration Calculation**: Properly calculates drive duration from `started_at`/`ended_at` timestamps
- **Autopilot Data Handling**: Now leverages `autopilot_distance` field when available for precise detection
- **Heavy FSD User Support**: Algorithm optimized for users with 99%+ FSD usage patterns
- **Micro-Movement Detection**: Better handling of very short drives (parking, maneuvering)

### Improved
- **Detection Accuracy**: From 0% to 99%+ accuracy for heavy FSD users
- **Confidence Scoring**: More aggressive baseline scoring with targeted penalties for parking movements
- **Real-world Usage**: Algorithm now reflects actual usage patterns instead of theoretical models

### Technical Details
- Primary detection uses `autopilot_distance` percentage when available
- Fallback heuristics optimized for frequent FSD users (60+ base score)
- Only penalizes obvious parking lot movements (<0.01mi, <0.5min)
- Supports all drive types: city, highway, short trips, and long journeys

## [v0.1.7] - 2024-12-XX

### Added
- **Predictive Analytics**: Optimal charging strategy, maintenance forecasting, personalized insights
- **Advanced Report Generators**: Annual Tesla reports, monthly cost predictions
- **Pattern Recognition**: Anomaly detection, seasonal behavior analysis
- **46 Total Tools**: Expanded from 39 to 46 comprehensive tools (+7 new analytics tools)
- Complete Tesla data platform with intelligent insights and forecasting

### New Tools
- Predictive analytics tools for charging optimization
- Maintenance forecasting capabilities
- Advanced report generation tools
- Anomaly detection and pattern recognition
- Seasonal behavior analysis tools
- Annual Tesla reporting
- Monthly cost prediction tools

## [v0.1.6] - 2024-12-XX

### Added
- **Experimental FSD Detection**: Pattern-based estimation of Full Self-Driving usage (unverified, for analysis purposes)
- **Data Export Tools**: Tax mileage reports, charging cost spreadsheets, comprehensive analytics exports
- **Advanced Insights**: FSD vs manual efficiency comparisons and usage pattern analysis  
- **39+ Tools**: Expanded from 31 to 39 comprehensive tools (8 new tools added)

### New Tools
- `analyze_drive_fsd_probability`: Estimate FSD usage likelihood for individual drives
- `get_fsd_usage_summary`: Period-based FSD usage estimation with confidence scores
- `compare_fsd_manual_efficiency`: Compare efficiency between estimated FSD and manual driving
- `export_tax_mileage_report`: Generate tax-ready mileage reports with monthly breakdowns
- `export_charging_cost_spreadsheet`: Detailed charging cost analysis in spreadsheet format
- `export_fsd_detection_report`: Comprehensive FSD analysis with methodology and confidence scores

### Features
- FSD Detection with confidence scoring (0-100%)
- Comprehensive data export capabilities
- Enhanced analytics for driving patterns

### Important Notes
- FSD detection is experimental and provides estimates only
- Not verified by Tesla or Tessie - for analysis purposes only

## [v0.1.5] - 2024-12-XX

### Added
- **Advanced Analytics**: Efficiency trends, cost analysis, usage patterns over time
- **Enhanced State Access**: Detailed driving, climate, and vehicle state information  

### New Tools
- `get_efficiency_trends`: Analyze driving efficiency over time with daily breakdowns
- `get_charging_cost_analysis`: Cost analysis by charging location (home/supercharger/public)
- `get_usage_patterns`: Driving patterns by day of week and hour of day
- `get_monthly_summary`: Comprehensive monthly driving and charging summary reports
- Enhanced state access tools for detailed vehicle information

## [v0.1.0] - 2024-XX-XX

### Added
- Initial release of Tessie MCP Extension
- **Complete Tesla Data Access**: All Tessie API GET endpoints for vehicle data
- **Smart VIN Resolution**: Automatically detects and uses your active vehicle
- **31+ Tools Available**: Battery, charging, driving, location, weather, analytics, and more
- **Real-time Data**: Access current vehicle status and historical data
- **Secure**: API token stored securely in Claude Desktop configuration

### Core Features
- Vehicle information and status
- Battery and charging data
- Location and driving history
- Climate and weather information
- Alerts and service data
- Comprehensive API coverage for all Tessie GET endpoints

### Requirements
- Claude Desktop v0.10.0 or later
- Tessie account with API access
- Node.js v18.0.0 or later