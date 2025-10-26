#!/bin/bash

# Smithery Deployment Verification Script
# This script tests the deployed Tessie MCP Server on Smithery

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SMITHERY_URL="https://server.smithery.ai/@alexcz-a11y/tessie-mcp-fix/mcp"

echo "🚀 Tessie MCP Server - Smithery Deployment Verification"
echo "========================================================"
echo ""

# Test 1: Check if server responds to tools/list
echo "📋 Test 1: Checking server availability..."
RESPONSE=$(curl -s -X POST "$SMITHERY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }')

if echo "$RESPONSE" | grep -q '"result"'; then
  echo -e "${GREEN}✓${NC} Server is responding"
  
  # Count tools
  TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name"' | wc -l)
  echo -e "${GREEN}✓${NC} Found $TOOL_COUNT tools registered"
  
  # Check for expected tools
  EXPECTED_TOOLS=(
    "get_vehicle_current_state"
    "get_driving_history"
    "get_weekly_mileage"
    "analyze_latest_drive"
    "analyze_charging_costs"
    "calculate_trip_cost"
    "estimate_future_trip"
    "analyze_commute_patterns"
    "analyze_efficiency_trends"
    "get_smart_charging_reminders"
    "get_vehicles"
    "get_tire_pressure"
    "natural_language_query"
  )
  
  echo ""
  echo "🔍 Verifying tool registration..."
  MISSING_TOOLS=0
  for tool in "${EXPECTED_TOOLS[@]}"; do
    if echo "$RESPONSE" | grep -q "\"$tool\""; then
      echo -e "${GREEN}✓${NC} $tool"
    else
      echo -e "${RED}✗${NC} $tool (MISSING)"
      MISSING_TOOLS=$((MISSING_TOOLS + 1))
    fi
  done
  
  if [ $MISSING_TOOLS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ All tools registered successfully!${NC}"
  else
    echo ""
    echo -e "${RED}⚠️  $MISSING_TOOLS tool(s) missing${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗${NC} Server is not responding correctly"
  echo "Response: $RESPONSE"
  exit 1
fi

echo ""
echo "📊 Test 2: Checking server initialization..."
INIT_RESPONSE=$(curl -s -X POST "$SMITHERY_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "verification-script",
        "version": "1.0.0"
      }
    },
    "id": 2
  }')

if echo "$INIT_RESPONSE" | grep -q '"result"'; then
  echo -e "${GREEN}✓${NC} Server initialization successful"
  
  # Extract server info
  SERVER_NAME=$(echo "$INIT_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
  SERVER_VERSION=$(echo "$INIT_RESPONSE" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  echo -e "${GREEN}✓${NC} Server: $SERVER_NAME v$SERVER_VERSION"
else
  echo -e "${RED}✗${NC} Server initialization failed"
  echo "Response: $INIT_RESPONSE"
  exit 1
fi

echo ""
echo "🎯 Test 3: Checking configuration schema..."
# Check if tools have proper input schemas
if echo "$RESPONSE" | grep -q '"TESSIE_API_KEY"'; then
  echo -e "${GREEN}✓${NC} Configuration schema includes TESSIE_API_KEY"
else
  echo -e "${YELLOW}⚠${NC}  TESSIE_API_KEY not found in tool schemas (may be in server config)"
fi

echo ""
echo "========================================================"
echo -e "${GREEN}✅ Deployment verification complete!${NC}"
echo ""
echo "📌 Server Details:"
echo "   URL: $SMITHERY_URL"
echo "   Status: Active"
echo "   Tools: $TOOL_COUNT registered"
echo ""
echo "🎉 Your Tessie MCP Server is live and ready to use!"
echo ""
echo "📦 Install with:"
echo "   npx -y @smithery/cli install @alexcz-a11y/tessie-mcp-fix"
echo ""
echo "🔑 Don't forget to configure your TESSIE_API_KEY!"
echo "   Get it from: https://my.tessie.com/settings/api"
