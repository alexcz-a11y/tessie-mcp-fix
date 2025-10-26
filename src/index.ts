#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TessieClient } from './tessie-client.js';
import { TessieQueryOptimizer } from './query-optimizer.js';
import { DriveAnalyzer } from './drive-analyzer.js';
import { ChargingAnalyzer } from './charging-analyzer.js';
import { TripCalculator } from './trip-calculator.js';
import { CommuteAnalyzer } from './commute-analyzer.js';
import { EfficiencyAnalyzer } from './efficiency-analyzer.js';
import { ChargingReminderSystem } from './charging-reminder.js';
import { ErrorHandler, EnhancedError } from './error-handler.js';
import { GeocodingService } from './geocoding.js';

// Configuration schema - automatically detected by Smithery
export const configSchema = z.object({
  TESSIE_API_KEY: z.string()
    .min(1)
    .describe("Your Tessie API token from https://my.tessie.com/settings/api"),
});

export default function createServer({
  config
}: {
  config: z.infer<typeof configSchema>
}) {
  // Extract and validate API token from config
  const apiToken = config.TESSIE_API_KEY;
  
  // Validate API token
  if (!apiToken || apiToken.trim() === '') {
    throw new Error(
      'TESSIE_API_KEY is required. ' +
      'Get your API token from https://my.tessie.com/settings/api'
    );
  }
  
  // Additional validation for API key format
  if (apiToken.length < 10) {
    throw new Error(
      'TESSIE_API_KEY appears to be invalid. ' +
      'Please check your API token at https://my.tessie.com/settings/api'
    );
  }

  // Create MCP server
  const server = new McpServer({
    name: "tessie-mcp-server",
    title: "Tessie Vehicle Data",
    version: "1.1.1"
  });

  // Create clients with provided API token
  const tessieClient = new TessieClient(apiToken);
  const queryOptimizer = new TessieQueryOptimizer();
  const driveAnalyzer = new DriveAnalyzer();
  const chargingAnalyzer = new ChargingAnalyzer();
  const tripCalculator = new TripCalculator();
  const commuteAnalyzer = new CommuteAnalyzer();
  const efficiencyAnalyzer = new EfficiencyAnalyzer();
  const chargingReminderSystem = new ChargingReminderSystem();

  // ============================================================================
  // MCP PROTOCOL COMPLIANCE - RESPONSE FORMAT REQUIREMENTS
  // ============================================================================
  //
  // All tool handlers MUST return responses in the following MCP-compliant format:
  //
  // return {
  //   content: [
  //     {
  //       type: "text",
  //       text: JSON.stringify(responseData, null, 2)
  //     }
  //   ]
  // };
  //
  // This format is required by the Model Context Protocol specification and ensures
  // compatibility with strict MCP clients (Kiro, Cursor, Windsurf, VSCode).
  //
  // IMPORTANT NOTES:
  // - The response MUST have a top-level "content" array
  // - Each content item MUST have a "type" field (use "text" for JSON data)
  // - The "text" field MUST contain a JSON string of your response data
  // - Do NOT return custom top-level fields outside the content array
  // - Both success and error responses MUST follow this format
  //
  // TEMPLATE FOR NEW TOOLS:
  //
  // server.tool("tool_name", "description", schema, async (params) => {
  //   try {
  //     // Your business logic here
  //     const result = {
  //       // Your response data structure
  //     };
  //     
  //     // Wrap in MCP format
  //     return {
  //       content: [
  //         {
  //           type: "text",
  //           text: JSON.stringify(result, null, 2)
  //         }
  //       ]
  //     };
  //   } catch (error) {
  //     // Error responses also need MCP format
  //     return {
  //       content: [
  //         {
  //           type: "text",
  //           text: JSON.stringify({
  //             error: "Error message",
  //             suggestion: "Helpful suggestion"
  //           }, null, 2)
  //         }
  //       ]
  //     };
  //   }
  // });
  //
  // ============================================================================

  // Register get_vehicle_current_state tool
  server.tool(
    "get_vehicle_current_state",
    "Get the current state of a vehicle including location, battery level, odometer reading",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      use_cache: z.boolean().optional().default(true).describe("Whether to use cached data to avoid waking the vehicle")
    },
    async ({ vin, use_cache = true }) => {
      try {
        const state = await tessieClient.getVehicleState(vin, use_cache);

        // Get human-readable address from coordinates
        let address = 'Location unavailable';
        if (state.drive_state?.latitude && state.drive_state?.longitude) {
          try {
            address = await GeocodingService.reverseGeocode(
              state.drive_state.latitude,
              state.drive_state.longitude
            );
          } catch (error) {
            console.warn('Geocoding failed:', error);
            address = `${state.drive_state.latitude.toFixed(4)}, ${state.drive_state.longitude.toFixed(4)}`;
          }
        }

        const result = {
          vehicle: state.display_name || state.vehicle_state?.vehicle_name || `Vehicle ${state.vin?.slice(-6)}`,
          vin: state.vin,
          current_location: {
            address: address,
            latitude: state.drive_state?.latitude,
            longitude: state.drive_state?.longitude,
          },
          battery: {
            level: state.charge_state?.battery_level,
            range: state.charge_state?.est_battery_range,
            charging_state: state.charge_state?.charging_state,
            time_to_full_charge: state.charge_state?.time_to_full_charge,
          },
          vehicle_state: {
            locked: state.vehicle_state?.locked,
            sentry_mode: state.vehicle_state?.sentry_mode,
            odometer: state.vehicle_state?.odometer,
          },
          climate: {
            inside_temp: state.climate_state?.inside_temp,
            outside_temp: state.climate_state?.outside_temp,
            climate_on: state.climate_state?.is_climate_on,
          },
          last_updated: state.timestamp || new Date().toISOString(),
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const enhancedError = ErrorHandler.classifyError(error);

        if (ErrorHandler.shouldDegrade(enhancedError)) {
          return ErrorHandler.generateFallbackResponse(enhancedError, 'Vehicle state');
        }

        throw new Error(ErrorHandler.formatErrorForUser(enhancedError));
      }
    }
  );

  // Register get_driving_history tool
  server.tool(
    "get_driving_history",
    "Get driving history for a vehicle within a date range",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      start_date: z.string().optional().describe("Start date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)"),
      end_date: z.string().optional().describe("End date in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)"),
      limit: z.number().optional().default(50).describe("Maximum number of drives to return")
    },
    async ({ vin, start_date, end_date, limit = 50 }) => {
      try {
        const drives = await tessieClient.getDrives(vin, start_date, end_date, limit);
        const result = {
          vehicle_vin: vin,
          total_drives: drives.length,
          date_range: {
            start: start_date || 'Not specified',
            end: end_date || 'Not specified'
          },
          drives: drives.map(drive => ({
            id: drive.id,
            start_time: new Date(drive.started_at * 1000).toISOString(),
            end_time: new Date(drive.ended_at * 1000).toISOString(),
            starting_location: drive.starting_location,
            ending_location: drive.ending_location,
            distance_miles: drive.odometer_distance,
            duration_minutes: Math.round(((drive.ended_at - drive.started_at) / 60) * 100) / 100,
            starting_battery: drive.starting_battery,
            ending_battery: drive.ending_battery,
            battery_used: drive.starting_battery - drive.ending_battery,
            average_speed: drive.average_speed,
            max_speed: drive.max_speed,
          }))
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to get driving history: ${error}`);
      }
    }
  );

  // Register get_weekly_mileage tool
  server.tool(
    "get_weekly_mileage",
    "Calculate total miles driven in a specific week or time period",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      start_date: z.string().describe("Start date of the period (ISO format)"),
      end_date: z.string().describe("End date of the period (ISO format)")
    },
    async ({ vin, start_date, end_date }) => {
      try {
        const drives = await tessieClient.getDrives(vin, start_date, end_date, 500);

        const totalMiles = drives.reduce((sum, drive) => sum + drive.odometer_distance, 0);

        // Use DriveAnalyzer to predict autopilot usage for each drive
        let totalAutopilotMiles = 0;
        const dailyStats: { [key: string]: { miles: number; drives: number; autopilot_miles: number } } = {};

        drives.forEach(drive => {
          const date = new Date(drive.started_at * 1000).toISOString().split('T')[0];
          if (!dailyStats[date]) {
            dailyStats[date] = { miles: 0, drives: 0, autopilot_miles: 0 };
          }

          // Create a temporary merged drive to predict autopilot usage
          const tempMergedDrive = {
            id: `temp_${drive.id}`,
            originalDriveIds: [drive.id],
            started_at: drive.started_at,
            ended_at: drive.ended_at,
            starting_location: drive.starting_location,
            ending_location: drive.ending_location,
            starting_battery: drive.starting_battery,
            ending_battery: drive.ending_battery,
            total_distance: drive.odometer_distance,
            total_duration_minutes: (drive.ended_at - drive.started_at) / 60,
            driving_duration_minutes: (drive.ended_at - drive.started_at) / 60,
            stops: [],
            autopilot_distance: 0, // Will be predicted below
            autopilot_percentage: 0,
            energy_consumed: drive.starting_battery - drive.ending_battery,
            average_speed: drive.average_speed || 0,
            max_speed: drive.max_speed || 0
          };

          // Predict autopilot usage for this drive
          const predictedAutopilotMiles = driveAnalyzer.predictAutopilotUsage(tempMergedDrive);

          dailyStats[date].miles += drive.odometer_distance;
          dailyStats[date].drives += 1;
          dailyStats[date].autopilot_miles += predictedAutopilotMiles;

          totalAutopilotMiles += predictedAutopilotMiles;
        });

        const breakdown = Object.entries(dailyStats).map(([date, stats]) => ({
          date,
          miles: Math.round(stats.miles * 100) / 100,
          drives: stats.drives,
          autopilot_miles: Math.round(stats.autopilot_miles * 100) / 100,
          fsd_percentage: stats.miles > 0 ? Math.round((stats.autopilot_miles / stats.miles) * 10000) / 100 : 0,
        }));

        const result = {
          vehicle_vin: vin,
          period: { start_date, end_date },
          summary: {
            total_miles: Math.round(totalMiles * 100) / 100,
            total_drives: drives.length,
            total_autopilot_miles: Math.round(totalAutopilotMiles * 100) / 100,
            fsd_percentage: totalMiles > 0 ? Math.round((totalAutopilotMiles / totalMiles) * 10000) / 100 : 0,
          },
          daily_breakdown: breakdown.sort((a, b) => a.date.localeCompare(b.date))
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to get weekly mileage: ${error}`);
      }
    }
  );

  // Register analyze_latest_drive tool
  server.tool(
    "analyze_latest_drive",
    "Analyze the most recent drive with comprehensive metrics including duration, battery consumption, FSD usage, and drive merging for stops <7 minutes",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      days_back: z.number().optional().default(7).describe("Number of days to look back for recent drives")
    },
    async ({ vin, days_back = 7 }) => {
      try {
        // Calculate date range for recent drives
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days_back);

        // Get recent drives
        const drives = await tessieClient.getDrives(
          vin,
          startDate.toISOString(),
          endDate.toISOString(),
          100
        );

        if (drives.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: 'No drives found in the specified time period',
                  period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
                  suggestion: 'Try increasing days_back or check if the vehicle has been driven recently'
                }, null, 2)
              }
            ]
          };
        }

        // Analyze the latest drive
        const analysis = driveAnalyzer.analyzeLatestDrive(drives);

        if (!analysis) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: 'Could not analyze drives',
                  drives_found: drives.length,
                  suggestion: 'Drives may be incomplete or missing required data'
                }, null, 2)
              }
            ]
          };
        }

        const result = {
          analysis_summary: analysis.summary,
          detailed_analysis: {
            drive_details: {
              id: analysis.mergedDrive.id,
              original_drives: analysis.mergedDrive.originalDriveIds.length,
              start_time: new Date(analysis.mergedDrive.started_at * 1000).toISOString(),
              end_time: new Date(analysis.mergedDrive.ended_at * 1000).toISOString(),
              route: `${analysis.mergedDrive.starting_location} → ${analysis.mergedDrive.ending_location}`,
              distance_miles: analysis.mergedDrive.total_distance,
              total_duration_minutes: analysis.mergedDrive.total_duration_minutes,
              driving_duration_minutes: analysis.mergedDrive.driving_duration_minutes,
              average_speed_mph: analysis.mergedDrive.average_speed,
              max_speed_mph: analysis.mergedDrive.max_speed
            },
            stops: analysis.mergedDrive.stops.map(stop => ({
              location: stop.location,
              duration_minutes: stop.duration_minutes,
              type: stop.stop_type,
              time: `${new Date(stop.started_at * 1000).toLocaleTimeString()} - ${new Date(stop.ended_at * 1000).toLocaleTimeString()}`
            })),
            battery_analysis: {
              starting_level: `${analysis.mergedDrive.starting_battery}%`,
              ending_level: `${analysis.mergedDrive.ending_battery}%`,
              percentage_consumed: `${analysis.batteryConsumption.percentage_used}%`,
              estimated_kwh_used: analysis.batteryConsumption.estimated_kwh_used,
              efficiency_miles_per_kwh: analysis.batteryConsumption.efficiency_miles_per_kwh
            },
            fsd_analysis: {
              autopilot_miles: analysis.fsdAnalysis.total_autopilot_miles,
              fsd_percentage: `${analysis.fsdAnalysis.fsd_percentage}%`,
              data_available: true,
              note: analysis.fsdAnalysis.note
            }
          },
          metadata: {
            analysis_time: new Date().toISOString(),
            drives_analyzed: drives.length,
            period_searched: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
          }
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to analyze latest drive: ${error}`);
      }
    }
  );

  // Register analyze_charging_costs tool
  server.tool(
    "analyze_charging_costs",
    "Analyze charging sessions and costs from driving history, with recommendations to save money",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      start_date: z.string().optional().describe("Start date in ISO format (YYYY-MM-DD)"),
      end_date: z.string().optional().describe("End date in ISO format (YYYY-MM-DD)"),
      home_rate: z.number().optional().describe("Your home electricity rate per kWh (default: $0.13)"),
      peak_rate: z.number().optional().describe("Peak hour electricity rate per kWh (default: $0.32)"),
      off_peak_rate: z.number().optional().describe("Off-peak electricity rate per kWh (default: $0.09)")
    },
    async ({ vin, start_date, end_date, home_rate, peak_rate, off_peak_rate }) => {
      try {
        // Get driving history to analyze charging sessions
        const drives = await tessieClient.getDrives(vin, start_date, end_date, 500);

        if (drives.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: 'No drives found in the specified period',
                  suggestion: 'Try a longer date range or check if the vehicle has been driven recently'
                }, null, 2)
              }
            ]
          };
        }

        // Configure custom rates if provided
        const customRates = home_rate || peak_rate || off_peak_rate ? {
          home_rate_per_kwh: home_rate || 0.13,
          time_of_use: {
            off_peak: { hours: '23:00-07:00', rate: off_peak_rate || 0.09 },
            peak: { hours: '16:00-21:00', rate: peak_rate || 0.32 }
          }
        } : undefined;

        const analyzer = customRates ? new ChargingAnalyzer(customRates) : chargingAnalyzer;

        // Learn home/work locations from patterns
        analyzer.learnLocations(drives);

        // Detect charging sessions
        const sessions = analyzer.detectChargingSessions(drives);

        // Analyze costs and patterns
        const analysis = analyzer.analyzeChargingCosts(sessions);

        // Format response
        const result = {
          period: {
            start: start_date || 'Not specified',
            end: end_date || 'Not specified',
            days_analyzed: Math.ceil((drives[drives.length - 1].started_at - drives[0].started_at) / (60 * 60 * 24))
          },
          summary: {
            total_sessions: analysis.total_sessions,
            total_cost: `$${analysis.total_cost.toFixed(2)}`,
            total_energy: `${analysis.total_kwh.toFixed(1)} kWh`,
            total_miles_added: `${analysis.total_miles_added.toFixed(0)} miles`,
            avg_cost_per_session: `$${analysis.average_cost_per_session.toFixed(2)}`,
            avg_cost_per_kwh: `$${analysis.average_cost_per_kwh.toFixed(3)}/kWh`,
            cost_per_mile: `$${analysis.average_cost_per_mile.toFixed(3)}/mile`
          },
          breakdown_by_location: {
            home: {
              sessions: analysis.sessions_by_location.home.sessions,
              cost: `$${analysis.sessions_by_location.home.cost.toFixed(2)}`,
              energy: `${analysis.sessions_by_location.home.kwh.toFixed(1)} kWh`,
              percentage: analysis.total_cost > 0
                ? `${((analysis.sessions_by_location.home.cost / analysis.total_cost) * 100).toFixed(1)}%`
                : '0%'
            },
            supercharger: {
              sessions: analysis.sessions_by_location.supercharger.sessions,
              cost: `$${analysis.sessions_by_location.supercharger.cost.toFixed(2)}`,
              energy: `${analysis.sessions_by_location.supercharger.kwh.toFixed(1)} kWh`,
              percentage: analysis.total_cost > 0
                ? `${((analysis.sessions_by_location.supercharger.cost / analysis.total_cost) * 100).toFixed(1)}%`
                : '0%'
            },
            public: {
              sessions: analysis.sessions_by_location.public.sessions,
              cost: `$${analysis.sessions_by_location.public.cost.toFixed(2)}`,
              energy: `${analysis.sessions_by_location.public.kwh.toFixed(1)} kWh`,
              percentage: analysis.total_cost > 0
                ? `${((analysis.sessions_by_location.public.cost / analysis.total_cost) * 100).toFixed(1)}%`
                : '0%'
            },
            work: {
              sessions: analysis.sessions_by_location.work.sessions,
              cost: `$${analysis.sessions_by_location.work.cost.toFixed(2)}`,
              energy: `${analysis.sessions_by_location.work.kwh.toFixed(1)} kWh`,
              note: analysis.sessions_by_location.work.sessions > 0 ? 'Free workplace charging!' : 'No workplace charging detected'
            }
          },
          money_saving_tips: analysis.recommendations,
          potential_monthly_savings: `$${analysis.potential_savings.toFixed(2)}`,
          detailed_sessions: sessions.slice(0, 10).map(s => ({
            date: new Date(s.started_at * 1000).toLocaleDateString(),
            time: new Date(s.started_at * 1000).toLocaleTimeString(),
            location: s.location,
            type: s.location_type,
            battery_added: `${s.ending_battery - s.starting_battery}%`,
            energy: `${s.energy_added_kwh.toFixed(1)} kWh`,
            cost: `$${s.cost_estimate.toFixed(2)}`,
            duration: `${Math.round(s.duration_minutes)} min`,
            rate: s.charge_rate_kw ? `${s.charge_rate_kw} kW` : 'Unknown'
          }))
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to analyze charging costs: ${error}`);
      }
    }
  );

  // Register calculate_trip_cost tool
  server.tool(
    "calculate_trip_cost",
    "Calculate the cost and environmental impact of completed trips with gas comparison and optimization tips",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      start_date: z.string().optional().describe("Start date in ISO format (YYYY-MM-DD)"),
      end_date: z.string().optional().describe("End date in ISO format (YYYY-MM-DD)"),
      home_rate: z.number().optional().describe("Your home electricity rate per kWh (default: $0.13)"),
      gas_price: z.number().optional().describe("Current gas price per gallon (default: $4.50)")
    },
    async ({ vin, start_date, end_date, home_rate, gas_price }) => {
      try {
        const drives = await tessieClient.getDrives(vin, start_date, end_date, 100);

        if (drives.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: 'No drives found in the specified period',
                  suggestion: 'Try a longer date range or check if the vehicle has been driven recently'
                }, null, 2)
              }
            ]
          };
        }

        const analysis = tripCalculator.calculateTripCost(
          drives,
          home_rate || 0.13,
          0.28, // Supercharger rate
          gas_price || 4.50
        );

        // Calculate gas comparison savings
        const gasCost = analysis.comparison.vs_gas_vehicle.gas_cost_estimate;
        const evCost = analysis.cost_breakdown.total_cost;
        const savings = gasCost - evCost;
        const savingsPercent = gasCost > 0 ? (savings / gasCost) * 100 : 0;

        // Calculate optimal charging savings
        const optimalCost = analysis.comparison.vs_optimal_charging.optimal_cost;
        const optimalSavings = evCost - optimalCost;

        const result = {
          trip_overview: {
            distance: `${analysis.trip_summary.distance_miles} miles`,
            duration: `${analysis.trip_summary.duration_hours} hours`,
            efficiency: `${analysis.trip_summary.efficiency_miles_per_kwh} mi/kWh`,
            battery_used: `${analysis.trip_summary.battery_used_percent}%`,
            energy_consumed: `${analysis.trip_summary.energy_used_kwh} kWh`
          },
          cost_analysis: {
            total_cost: `$${analysis.cost_breakdown.total_cost.toFixed(2)}`,
            cost_per_mile: `$${analysis.cost_breakdown.cost_per_mile.toFixed(3)}/mile`,
            home_charging: `$${analysis.cost_breakdown.electricity_cost.toFixed(2)}`,
            supercharger_stops: `$${analysis.cost_breakdown.charging_stops_cost.toFixed(2)}`
          },
          savings_vs_gas: {
            gas_vehicle_cost: `$${gasCost.toFixed(2)}`,
            your_ev_cost: `$${evCost.toFixed(2)}`,
            money_saved: `$${savings.toFixed(2)}`,
            savings_percentage: `${savingsPercent.toFixed(1)}%`,
            note: savings > 0 ? '🎉 You saved money vs gas!' : '⚠️ Gas would have been cheaper'
          },
          optimization_opportunities: {
            current_cost: `$${evCost.toFixed(2)}`,
            optimal_cost: `$${optimalCost.toFixed(2)}`,
            potential_savings: `$${optimalSavings.toFixed(2)}`,
            efficiency_tips: analysis.charging_strategy
          },
          environmental_impact: {
            co2_emissions_avoided: `${analysis.environmental_impact.co2_saved_lbs} lbs`,
            trees_planted_equivalent: `${analysis.environmental_impact.trees_equivalent} trees`,
            impact_note: analysis.environmental_impact.co2_saved_lbs > 0
              ? '🌱 Your trip was carbon-friendly!'
              : '⚠️ Grid emissions offset EV benefits'
          }
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to calculate trip cost: ${error}`);
      }
    }
  );

  // Register estimate_future_trip tool
  server.tool(
    "estimate_future_trip",
    "Estimate cost and charging strategy for a planned trip based on distance and current battery level",
    {
      distance_miles: z.number().describe("Trip distance in miles"),
      current_battery_percent: z.number().min(0).max(100).describe("Current battery percentage"),
      home_rate: z.number().optional().describe("Your home electricity rate per kWh (default: $0.13)"),
      supercharger_rate: z.number().optional().describe("Supercharger rate per kWh (default: $0.28)")
    },
    async ({ distance_miles, current_battery_percent, home_rate, supercharger_rate }) => {
      try {
        const estimate = tripCalculator.estimateFutureTripCost(
          distance_miles,
          current_battery_percent,
          home_rate || 0.13,
          supercharger_rate || 0.28
        );

        const result = {
          trip_feasibility: {
            distance: `${distance_miles} miles`,
            current_charge: `${current_battery_percent}%`,
            charging_required: estimate.charging_needed ? 'Yes' : 'No',
            estimated_cost: `$${estimate.estimated_cost.toFixed(2)}`
          },
          charging_strategy: {
            recommended_departure_charge: `${estimate.recommended_charge_level}%`,
            supercharger_stops_needed: estimate.charging_stops_needed,
            strategy_details: estimate.strategy
          },
          cost_breakdown: {
            total_estimated_cost: `$${estimate.estimated_cost.toFixed(2)}`,
            cost_per_mile: `$${(estimate.estimated_cost / distance_miles).toFixed(3)}/mile`
          },
          preparation_tips: estimate.charging_needed ? [
            `🔌 Pre-charge to ${estimate.recommended_charge_level}% before departure`,
            '🗺️ Plan Supercharger stops using Tesla navigation',
            '📱 Check Supercharger availability along your route',
            '⏰ Allow extra time for charging stops',
            estimate.charging_stops_needed > 0
              ? `🛑 Plan for ${estimate.charging_stops_needed} charging stop${estimate.charging_stops_needed > 1 ? 's' : ''}`
              : ''
          ].filter(Boolean) : [
            '✅ No additional charging needed for this trip!',
            '🎯 Your current charge is sufficient',
            '📊 Monitor efficiency during the trip'
          ]
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to estimate future trip: ${error}`);
      }
    }
  );

  // Register analyze_commute_patterns tool
  server.tool(
    "analyze_commute_patterns",
    "Detect regular commute routes and analyze efficiency trends, time patterns, and costs",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      days_back: z.number().optional().default(30).describe("Number of days to analyze (default: 30)")
    },
    async ({ vin, days_back = 30 }) => {
      try {
        // Get driving history for pattern analysis
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days_back);

        const drives = await tessieClient.getDrives(
          vin,
          startDate.toISOString(),
          endDate.toISOString(),
          500
        );

        if (drives.length < 10) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: 'Not enough driving data to detect commute patterns',
                  drives_found: drives.length,
                  suggestion: 'Try increasing days_back parameter or drive more regularly to establish patterns'
                }, null, 2)
              }
            ]
          };
        }

        const analysis = commuteAnalyzer.analyzeCommutes(drives);

        const result = {
          analysis_period: {
            days_analyzed: days_back,
            drives_analyzed: drives.length,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0]
          },
          commute_overview: {
            routes_detected: analysis.routes_detected,
            total_weekly_commute_miles: analysis.total_commute_miles,
            estimated_weekly_cost: `$${analysis.total_commute_cost.toFixed(2)}`,
            avg_commute_efficiency: `${analysis.avg_commute_efficiency} kWh/100mi`
          },
          regular_routes: analysis.routes.map(route => ({
            route_name: route.name,
            frequency: `${route.frequency.toFixed(1)} times/week`,
            typical_distance: `${route.typical_distance} miles`,
            avg_duration: `${Math.round(route.avg_duration_minutes)} minutes`,
            efficiency: `${route.avg_efficiency_kwh_per_100mi.toFixed(1)} kWh/100mi`,
            trend: route.recent_trend,
            trend_emoji: route.recent_trend === 'improving' ? '📈' :
              route.recent_trend === 'declining' ? '📉' : '➡️',
            commute_times: {
              morning_rush: route.time_patterns.morning_commute.count > 0
                ? `${route.time_patterns.morning_commute.count} drives, avg ${route.time_patterns.morning_commute.avg_time}`
                : 'No morning commutes detected',
              evening_rush: route.time_patterns.evening_commute.count > 0
                ? `${route.time_patterns.evening_commute.count} drives, avg ${route.time_patterns.evening_commute.avg_time}`
                : 'No evening commutes detected',
              weekend: route.time_patterns.weekend.count > 0
                ? `${route.time_patterns.weekend.count} drives, avg ${route.time_patterns.weekend.avg_time}`
                : 'No weekend drives'
            },
            efficiency_range: {
              best: `${route.best_efficiency.toFixed(1)} kWh/100mi`,
              worst: `${route.worst_efficiency.toFixed(1)} kWh/100mi`,
              variation: `${((route.worst_efficiency - route.best_efficiency) / route.best_efficiency * 100).toFixed(1)}%`
            }
          })),
          weekly_patterns: {
            total_drives: analysis.weekly_summary.total_drives,
            total_miles: `${analysis.weekly_summary.total_miles} miles`,
            estimated_cost: `$${analysis.weekly_summary.total_cost.toFixed(2)}`,
            avg_efficiency: `${analysis.weekly_summary.avg_efficiency} kWh/100mi`,
            most_efficient_day: analysis.weekly_summary.best_day,
            least_efficient_day: analysis.weekly_summary.worst_day
          },
          optimization_tips: analysis.recommendations,
          cost_insights: analysis.routes.length > 0 ? [
            `💰 Your regular commutes cost approximately $${analysis.total_commute_cost.toFixed(2)}/week`,
            `⚡ At current efficiency, you use ~${(analysis.total_commute_miles * analysis.avg_commute_efficiency / 100).toFixed(1)} kWh/week for commuting`,
            analysis.avg_commute_efficiency > 25
              ? `🚨 High commute energy usage - consider eco-driving techniques`
              : `✅ Good commute efficiency - you're driving efficiently!`
          ] : ['No regular commute patterns detected']
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to analyze commute patterns: ${error}`);
      }
    }
  );

  // Register analyze_efficiency_trends tool
  server.tool(
    "analyze_efficiency_trends",
    "Analyze driving efficiency trends over time with weather, speed, and time pattern insights",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      days_back: z.number().optional().default(45).describe("Number of days to analyze (default: 45, minimum: 14)")
    },
    async ({ vin, days_back = 45 }) => {
      try {
        if (days_back < 14) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Minimum 14 days required for meaningful trend analysis",
                  suggestion: "Try days_back >= 14 for better insights"
                }, null, 2)
              }
            ]
          };
        }

        // Get driving history for efficiency analysis
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days_back);

        const drives = await tessieClient.getDrives(
          vin,
          startDate.toISOString(),
          endDate.toISOString(),
          200
        );

        if (drives.length < 5) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Insufficient driving data for trend analysis",
                  drives_found: drives.length,
                  suggestion: 'Need at least 5 drives for efficiency analysis'
                }, null, 2)
              }
            ]
          };
        }

        const analysis = efficiencyAnalyzer.analyzeEfficiencyTrends(drives);

        const result = {
          analysis_period: {
            days_analyzed: days_back,
            drives_analyzed: drives.length,
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0]
          },
          current_efficiency: {
            average: `${analysis.current_period.avg_efficiency} kWh/100mi`,
            total_miles: `${analysis.current_period.total_miles} miles`,
            total_drives: analysis.current_period.total_drives,
            efficiency_range: {
              best: `${analysis.current_period.efficiency_range.best} kWh/100mi`,
              worst: `${analysis.current_period.efficiency_range.worst} kWh/100mi`,
              spread: `${(analysis.current_period.efficiency_range.worst - analysis.current_period.efficiency_range.best).toFixed(1)} kWh/100mi variation`
            }
          },
          trends: {
            weekly: {
              direction: analysis.trends.weekly.trend_direction,
              change: `${analysis.trends.weekly.trend_percentage.toFixed(1)}%`,
              confidence: analysis.trends.weekly.confidence,
              emoji: analysis.trends.weekly.trend_direction === 'improving' ? '📈' :
                analysis.trends.weekly.trend_direction === 'declining' ? '📉' : '➡️',
              summary: analysis.trends.weekly.trend_direction === 'stable'
                ? `Stable efficiency at ${analysis.trends.weekly.avg_efficiency} kWh/100mi`
                : `${analysis.trends.weekly.trend_direction === 'improving' ? 'Improving' : 'Declining'} by ${analysis.trends.weekly.trend_percentage.toFixed(1)}% - current avg: ${analysis.trends.weekly.avg_efficiency} kWh/100mi`
            },
            monthly: {
              direction: analysis.trends.monthly.trend_direction,
              change: `${analysis.trends.monthly.trend_percentage.toFixed(1)}%`,
              confidence: analysis.trends.monthly.confidence,
              summary: analysis.trends.monthly.confidence !== 'low'
                ? `Monthly trend: ${analysis.trends.monthly.trend_direction} (${analysis.trends.monthly.trend_percentage.toFixed(1)}%)`
                : 'Insufficient data for monthly trend'
            },
            seasonal: {
              direction: analysis.trends.seasonal.trend_direction,
              change: `${analysis.trends.seasonal.trend_percentage.toFixed(1)}%`,
              confidence: analysis.trends.seasonal.confidence,
              summary: analysis.trends.seasonal.confidence !== 'low'
                ? `Seasonal trend: ${analysis.trends.seasonal.trend_direction} (${analysis.trends.seasonal.trend_percentage.toFixed(1)}%)`
                : 'Need more data for seasonal analysis'
            }
          },
          efficiency_factors: {
            weather_impact: {
              hot_weather_penalty: `+${analysis.factors_analysis.weather_impact.hot_weather_penalty.toFixed(1)}%`,
              cold_weather_penalty: `+${analysis.factors_analysis.weather_impact.cold_weather_penalty.toFixed(1)}%`,
              optimal_temp_range: analysis.factors_analysis.weather_impact.optimal_temp_range,
              insight: analysis.factors_analysis.weather_impact.cold_weather_penalty > 15
                ? "❄️ Cold weather significantly impacting efficiency"
                : analysis.factors_analysis.weather_impact.hot_weather_penalty > 10
                  ? "🔥 Hot weather and A/C affecting efficiency"
                  : "🌡️ Weather impact is minimal"
            },
            speed_impact: {
              highway_efficiency: `${analysis.factors_analysis.speed_impact.highway_efficiency} kWh/100mi`,
              city_efficiency: `${analysis.factors_analysis.speed_impact.city_efficiency} kWh/100mi`,
              optimal_speed_range: analysis.factors_analysis.speed_impact.optimal_speed_range,
              preference: analysis.factors_analysis.speed_impact.highway_efficiency < analysis.factors_analysis.speed_impact.city_efficiency
                ? "🛣️ Highway driving is more efficient"
                : "🏙️ City driving is more efficient"
            },
            time_patterns: {
              best_day: analysis.factors_analysis.time_patterns.best_day_of_week,
              worst_day: analysis.factors_analysis.time_patterns.worst_day_of_week,
              best_time: analysis.factors_analysis.time_patterns.best_time_of_day,
              scheduling_tip: analysis.factors_analysis.time_patterns.best_day_of_week !== 'Unknown'
                ? `📅 Schedule trips on ${analysis.factors_analysis.time_patterns.best_day_of_week}s for best efficiency`
                : "📅 No clear daily efficiency patterns detected"
            }
          },
          actionable_insights: analysis.insights,
          optimization_recommendations: analysis.recommendations,
          efficiency_score: {
            current: analysis.current_period.avg_efficiency < 25 ? "Excellent" :
              analysis.current_period.avg_efficiency < 30 ? "Good" :
                analysis.current_period.avg_efficiency < 35 ? "Average" : "Needs Improvement",
            benchmark: "Model 3/Y typical: 25-30 kWh/100mi",
            comparison: analysis.current_period.avg_efficiency < 25
              ? "🏆 You're driving very efficiently!"
              : analysis.current_period.avg_efficiency < 30
                ? "✅ Good efficiency - room for minor improvements"
                : analysis.current_period.avg_efficiency < 35
                  ? "⚠️ Average efficiency - focus on eco-driving techniques"
                  : "🚨 High consumption - review driving habits and vehicle maintenance"
          }
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to analyze efficiency trends: ${error}`);
      }
    }
  );

  // Register get_smart_charging_reminders tool
  server.tool(
    "get_smart_charging_reminders",
    "Get intelligent charging reminders and optimization strategy based on current vehicle state, usage patterns, and conditions",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      daily_miles: z.number().optional().default(40).describe("Average daily driving miles (default: 40)"),
      next_trip_distance: z.number().optional().describe("Distance of upcoming trip in miles"),
      weather_temp: z.number().optional().describe("Current or forecast temperature in Fahrenheit")
    },
    async ({ vin, daily_miles = 40, next_trip_distance, weather_temp }) => {
      try {
        // Get current vehicle state
        const state = await tessieClient.getVehicleState(vin);

        // Extract battery level from nested structure
        const batteryLevel = state.charge_state?.battery_level;

        if (!batteryLevel) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Unable to get battery information",
                  suggestion: "Make sure vehicle is awake and connected to Tessie"
                }, null, 2)
              }
            ]
          };
        }

        // Create a flattened state object for the charging reminder system
        const flatState = {
          ...state,
          battery_level: state.charge_state?.battery_level,
          battery_range: state.charge_state?.est_battery_range,
          charging_state: state.charge_state?.charging_state,
          latitude: state.drive_state?.latitude,
          longitude: state.drive_state?.longitude
        };

        // Generate smart charging strategy
        const strategy = chargingReminderSystem.generateChargingStrategy(
          flatState,
          daily_miles,
          next_trip_distance,
          weather_temp
        );

        const result = {
          vehicle_info: {
            vin: vin,
            timestamp: new Date().toISOString(),
            location: state.drive_state?.latitude && state.drive_state?.longitude
              ? await GeocodingService.reverseGeocode(state.drive_state.latitude, state.drive_state.longitude)
              : 'Location unavailable'
          },
          charging_status: {
            battery_level: `${strategy.current_status.battery_level}%`,
            estimated_range: `${strategy.current_status.range_miles} miles`,
            charging_state: strategy.current_status.charging_state,
            plugged_in: strategy.current_status.plugged_in,
            status_emoji: strategy.current_status.plugged_in ? '🔌' :
              strategy.current_status.battery_level < 20 ? '🔋' :
                strategy.current_status.battery_level > 80 ? '✅' : '⚡'
          },
          urgent_reminders: strategy.recommendations
            .filter(r => r.priority === 'urgent' || r.priority === 'high')
            .map(r => ({
              priority: r.priority.toUpperCase(),
              title: r.title,
              message: r.message,
              action_required: r.action_required,
              deadline: r.deadline || 'None',
              savings: r.estimated_savings || 'N/A',
              emoji: r.priority === 'urgent' ? '🚨' : '⚠️'
            })),
          optimization_suggestions: strategy.recommendations
            .filter(r => r.priority === 'medium' || r.priority === 'low')
            .map(r => ({
              category: r.type.replace('_', ' ').toUpperCase(),
              title: r.title,
              message: r.message,
              potential_savings: r.estimated_savings || 'N/A',
              time_sensitive: r.time_sensitive || false
            })),
          charging_schedule: {
            optimal_timing: {
              start: strategy.charging_schedule.optimal_start_time,
              end: strategy.charging_schedule.optimal_end_time,
              off_peak_window: strategy.charging_schedule.off_peak_window,
              estimated_savings: `$${strategy.charging_schedule.estimated_cost_savings.toFixed(2)}`
            },
            current_recommendation: strategy.current_status.plugged_in
              ? "Currently charging - monitor for completion"
              : strategy.current_status.battery_level < 50
                ? "🔌 Plug in tonight for off-peak charging"
                : strategy.current_status.battery_level > 80
                  ? "✅ Well charged - no immediate action needed"
                  : "⚡ Consider charging if planning long trips"
          },
          range_analysis: {
            comfort_level: strategy.range_analysis.comfort_range ? "Comfortable" : "Low",
            emergency_status: strategy.range_analysis.emergency_range ? "CRITICAL" : "Safe",
            recommended_charge_target: `${strategy.range_analysis.recommended_charge_level}%`,
            next_charge_timing: strategy.range_analysis.next_charge_needed,
            range_emoji: strategy.range_analysis.emergency_range ? '🚨' :
              strategy.range_analysis.comfort_range ? '✅' : '⚠️'
          },
          smart_insights: strategy.smart_insights.map(insight => ({
            insight: insight,
            category: insight.includes('💸') ? 'Cost Optimization' :
              insight.includes('🔋') ? 'Battery Health' :
                insight.includes('❄️') || insight.includes('🌡️') ? 'Weather Impact' :
                  insight.includes('📅') ? 'Planning' : 'General'
          })),
          weather_considerations: weather_temp ? {
            current_temp: `${weather_temp}°F`,
            impact: weather_temp < 32 ? "❄️ Cold weather reduces range 20-30%" :
              weather_temp > 85 ? "🔥 Hot weather increases A/C usage 10-15%" :
                "🌤️ Mild weather - optimal efficiency conditions",
            recommendation: weather_temp < 32 ? "Charge to 90% and precondition cabin" :
              weather_temp > 85 ? "Precondition cabin and consider shade parking" :
                "Standard charging routine is fine"
          } : {
            current_temp: "Not provided",
            impact: "🌡️ Weather data not available",
            recommendation: "Provide weather_temp parameter for weather-specific advice"
          },
          cost_optimization: {
            peak_vs_offpeak: "Off-peak charging saves ~60-70% on electricity costs",
            daily_cost_estimate: daily_miles ? `~$${(daily_miles * 0.04).toFixed(2)}/day at off-peak rates` : "Varies by usage",
            monthly_savings_potential: `$${(strategy.charging_schedule.estimated_cost_savings * 15).toFixed(2)}/month with optimal timing`,
            tip: "💡 Use Tesla app to schedule charging for 11 PM - 7 AM"
          }
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        throw new Error(`Failed to get charging reminders: ${error}`);
      }
    }
  );

  // Register get_vehicles tool
  server.tool(
    "get_vehicles",
    "List all vehicles in the Tessie account",
    {},
    async () => {
      try {
        const vehicles = await tessieClient.getVehicles();
        const result = {
          total_vehicles: vehicles.length,
          vehicles: vehicles.map(vehicle => ({
            vin: vehicle.vin,
            display_name: vehicle.display_name
          }))
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const enhancedError = ErrorHandler.classifyError(error);

        if (ErrorHandler.shouldDegrade(enhancedError)) {
          const fallbackData = {
            status: 'degraded',
            error_type: enhancedError.type,
            message: enhancedError.userFriendly,
            suggestion: enhancedError.suggestion,
            vehicles: [],
            fallback_note: 'Vehicle list temporarily unavailable. Try again in a few moments.'
          };

          // Wrap error fallback in MCP format
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(fallbackData, null, 2)
              }
            ]
          };
        }

        throw new Error(ErrorHandler.formatErrorForUser(enhancedError));
      }
    }
  );

  // Register get_tire_pressure tool
  server.tool(
    "get_tire_pressure",
    "Get current tire pressure readings for all four tires with status indicators",
    {
      vin: z.string().describe("Vehicle identification number (VIN)"),
      pressure_format: z.enum(['bar', 'kpa', 'psi']).optional().default('psi').describe("Pressure unit (default: psi)"),
      from: z.number().optional().describe("Start timestamp for historical data (Unix timestamp in seconds)"),
      to: z.number().optional().describe("End timestamp for historical data (Unix timestamp in seconds)")
    },
    async ({ vin, pressure_format = 'psi', from, to }) => {
      try {
        const tirePressure = await tessieClient.getTirePressure(vin, pressure_format, from, to);

        const result = {
          vehicle_vin: vin,
          timestamp: new Date(tirePressure.timestamp * 1000).toISOString(),
          pressure_unit: pressure_format,
          tire_pressures: {
            front_left: {
              pressure: tirePressure.front_left,
              status: tirePressure.front_left_status,
              emoji: tirePressure.front_left_status === 'low' ? '⚠️' : 
                     tirePressure.front_left_status === 'normal' ? '✅' : '❓'
            },
            front_right: {
              pressure: tirePressure.front_right,
              status: tirePressure.front_right_status,
              emoji: tirePressure.front_right_status === 'low' ? '⚠️' : 
                     tirePressure.front_right_status === 'normal' ? '✅' : '❓'
            },
            rear_left: {
              pressure: tirePressure.rear_left,
              status: tirePressure.rear_left_status,
              emoji: tirePressure.rear_left_status === 'low' ? '⚠️' : 
                     tirePressure.rear_left_status === 'normal' ? '✅' : '❓'
            },
            rear_right: {
              pressure: tirePressure.rear_right,
              status: tirePressure.rear_right_status,
              emoji: tirePressure.rear_right_status === 'low' ? '⚠️' : 
                     tirePressure.rear_right_status === 'normal' ? '✅' : '❓'
            }
          },
          overall_status: {
            all_normal: [
              tirePressure.front_left_status,
              tirePressure.front_right_status,
              tirePressure.rear_left_status,
              tirePressure.rear_right_status
            ].every(status => status === 'normal'),
            low_pressure_count: [
              tirePressure.front_left_status,
              tirePressure.front_right_status,
              tirePressure.rear_left_status,
              tirePressure.rear_right_status
            ].filter(status => status === 'low').length,
            summary: [
              tirePressure.front_left_status,
              tirePressure.front_right_status,
              tirePressure.rear_left_status,
              tirePressure.rear_right_status
            ].every(status => status === 'normal')
              ? '✅ All tires are properly inflated'
              : [
                  tirePressure.front_left_status,
                  tirePressure.front_right_status,
                  tirePressure.rear_left_status,
                  tirePressure.rear_right_status
                ].filter(status => status === 'low').length > 0
                ? `⚠️ ${[
                    tirePressure.front_left_status,
                    tirePressure.front_right_status,
                    tirePressure.rear_left_status,
                    tirePressure.rear_right_status
                  ].filter(status => status === 'low').length} tire(s) with low pressure - inflate soon`
                : '❓ Tire pressure status unknown - check vehicle display'
          },
          recommendations: [
            tirePressure.front_left_status,
            tirePressure.front_right_status,
            tirePressure.rear_left_status,
            tirePressure.rear_right_status
          ].some(status => status === 'low')
            ? [
                '🔧 Inflate low pressure tires to recommended PSI (check door jamb sticker)',
                '⚡ Proper tire pressure improves efficiency by 3-5%',
                '🛡️ Correct pressure extends tire life and improves safety'
              ]
            : [
                '✅ Tire pressures are good',
                '📅 Check tire pressure monthly for optimal performance',
                '🌡️ Remember: tire pressure drops ~1 PSI per 10°F temperature decrease'
              ]
        };

        // Wrap in MCP format
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const enhancedError = ErrorHandler.classifyError(error);

        if (ErrorHandler.shouldDegrade(enhancedError)) {
          return ErrorHandler.generateFallbackResponse(enhancedError, 'Tire pressure data');
        }

        throw new Error(ErrorHandler.formatErrorForUser(enhancedError));
      }
    }
  );

  // Register natural_language_query tool
  server.tool(
    "natural_language_query",
    "Process natural language queries about your vehicle data (e.g., \"How many miles did I drive last week?\")",
    {
      query: z.string().describe("Natural language query about vehicle data"),
      vin: z.string().optional().describe("Vehicle identification number (VIN) - optional if only one vehicle")
    },
    async ({ query, vin }) => {
      try {
        // Parse the natural language query
        const parsed = queryOptimizer.parseNaturalLanguage(query);

        if (parsed.confidence < 0.5) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "Could not understand the query",
                  confidence: parsed.confidence,
                  suggestions: [
                    "Try queries like: 'How many miles did I drive last week?'",
                    "Or: 'What's my current battery level?'",
                    "Or: 'Analyze my latest drive'"
                  ]
                }, null, 2)
              }
            ]
          };
        }

        // If no VIN provided, try to get the first vehicle
        let targetVin = vin;
        if (!targetVin) {
          const vehicles = await tessieClient.getVehicles();
          if (vehicles.length === 0) {
            throw new Error("No vehicles found in account");
          }
          targetVin = vehicles[0].vin;
        }

        // Execute the appropriate tool based on parsed operation
        switch (parsed.operation) {
          case 'get_vehicle_current_state':
            const state = await tessieClient.getVehicleState(targetVin, true);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query_understood: query,
                    confidence: parsed.confidence,
                    result: {
                      vehicle: state.display_name,
                      battery_level: state.charge_state?.battery_level,
                      location: {
                        latitude: state.drive_state?.latitude,
                        longitude: state.drive_state?.longitude
                      },
                      locked: state.vehicle_state?.locked,
                      odometer: state.vehicle_state?.odometer
                    }
                  }, null, 2)
                }
              ]
            };

          case 'get_weekly_mileage':
          case 'get_driving_history':
            const drives = await tessieClient.getDrives(
              targetVin,
              parsed.parameters.start_date,
              parsed.parameters.end_date,
              50
            );
            const totalMiles = drives.reduce((sum, drive) => sum + drive.odometer_distance, 0);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query_understood: query,
                    confidence: parsed.confidence,
                    result: {
                      total_miles: Math.round(totalMiles * 100) / 100,
                      total_drives: drives.length,
                      period: {
                        start: parsed.parameters.start_date,
                        end: parsed.parameters.end_date
                      }
                    }
                  }, null, 2)
                }
              ]
            };

          case 'analyze_latest_drive':
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - (parsed.parameters.days_back || 7));

            const recentDrives = await tessieClient.getDrives(
              targetVin,
              startDate.toISOString(),
              endDate.toISOString(),
              100
            );

            const analysis = driveAnalyzer.analyzeLatestDrive(recentDrives);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query_understood: query,
                    confidence: parsed.confidence,
                    result: analysis ? {
                      summary: analysis.summary,
                      drive_distance: analysis.mergedDrive.total_distance,
                      battery_used: analysis.batteryConsumption.percentage_used,
                      fsd_miles: analysis.fsdAnalysis.total_autopilot_miles
                    } : { error: "No recent drives found" }
                  }, null, 2)
                }
              ]
            };

          default:
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    query_understood: query,
                    confidence: parsed.confidence,
                    error: "Query understood but operation not yet implemented",
                    parsed_operation: parsed.operation
                  }, null, 2)
                }
              ]
            };
        }
      } catch (error) {
        throw new Error(`Failed to process natural language query: ${error}`);
      }
    }
  );

  // Return the server object (Smithery CLI handles transport)
  return server.server;
}