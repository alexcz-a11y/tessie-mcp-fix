#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TessieClient } from './tessie-client.js';
import { TessieQueryOptimizer } from './query-optimizer.js';
import { DriveAnalyzer } from './drive-analyzer.js';

// Configuration schema - automatically detected by Smithery
export const configSchema = z.object({
  apiKey: z.string().describe("Your API key"),
  modelName: z.string().default("gpt-4").describe("Model to use"),
  temperature: z.number().min(0).max(1).default(0.7).describe("Temperature setting"),
});

export default function createServer({
  config
}: {
  config: z.infer<typeof configSchema>
}) {
    // Create MCP server
    const server = new McpServer({
      name: "tessie-mcp-server",
      title: "Tessie Vehicle Data",
      version: "1.1.1"
    });

    // Use config values in your tools
    console.log(`Using model: ${config.modelName}`);

    // Initialize clients
    const apiToken = config.apiKey;

    // Create clients with provided API token
    const tessieClient = new TessieClient(apiToken);
    const queryOptimizer = new TessieQueryOptimizer();
    const driveAnalyzer = new DriveAnalyzer();

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
          return {
            vehicle: state.display_name || state.vehicle_state?.vehicle_name || `Vehicle ${state.vin?.slice(-6)}`,
            vin: state.vin,
            current_location: {
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
        } catch (error) {
          throw new Error(`Failed to get vehicle state: ${error}`);
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
          return {
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
              autopilot_distance: drive.autopilot_distance || 0,
            }))
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
          const totalAutopilotMiles = drives.reduce((sum, drive) => sum + (drive.autopilot_distance || 0), 0);

          // Group drives by day for weekly breakdown
          const dailyStats: { [key: string]: { miles: number; drives: number; autopilot_miles: number } } = {};

          drives.forEach(drive => {
            const date = new Date(drive.started_at * 1000).toISOString().split('T')[0];
            if (!dailyStats[date]) {
              dailyStats[date] = { miles: 0, drives: 0, autopilot_miles: 0 };
            }
            dailyStats[date].miles += drive.odometer_distance;
            dailyStats[date].drives += 1;
            dailyStats[date].autopilot_miles += drive.autopilot_distance || 0;
          });

          const breakdown = Object.entries(dailyStats).map(([date, stats]) => ({
            date,
            miles: Math.round(stats.miles * 100) / 100,
            drives: stats.drives,
            autopilot_miles: Math.round(stats.autopilot_miles * 100) / 100,
            fsd_percentage: stats.miles > 0 ? Math.round((stats.autopilot_miles / stats.miles) * 10000) / 100 : 0,
          }));

          return {
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
              error: 'No drives found in the specified time period',
              period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
              suggestion: 'Try increasing days_back or check if the vehicle has been driven recently'
            };
          }

          // Analyze the latest drive
          const analysis = driveAnalyzer.analyzeLatestDrive(drives);

          if (!analysis) {
            return {
              error: 'Could not analyze drives',
              drives_found: drives.length,
              suggestion: 'Drives may be incomplete or missing required data'
            };
          }

          return {
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
                data_available: analysis.fsdAnalysis.autopilot_available,
                note: analysis.fsdAnalysis.note
              }
            },
            metadata: {
              analysis_time: new Date().toISOString(),
              drives_analyzed: drives.length,
              period_searched: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`
            }
          };
        } catch (error) {
          throw new Error(`Failed to analyze latest drive: ${error}`);
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
          return {
            total_vehicles: vehicles.length,
            vehicles: vehicles.map(vehicle => ({
              vin: vehicle.vin,
              display_name: vehicle.display_name
            }))
          };
        } catch (error) {
          throw new Error(`Failed to get vehicles: ${error}`);
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
              error: "Could not understand the query",
              confidence: parsed.confidence,
              suggestions: [
                "Try queries like: 'How many miles did I drive last week?'",
                "Or: 'What's my current battery level?'",
                "Or: 'Analyze my latest drive'"
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
                query_understood: query,
                confidence: parsed.confidence,
                result: {
                  vehicle: state.display_name,
                  battery_level: state.battery_level,
                  location: { latitude: state.latitude, longitude: state.longitude },
                  locked: state.locked,
                  odometer: state.odometer
                }
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
                query_understood: query,
                confidence: parsed.confidence,
                result: analysis ? {
                  summary: analysis.summary,
                  drive_distance: analysis.mergedDrive.total_distance,
                  battery_used: analysis.batteryConsumption.percentage_used,
                  fsd_miles: analysis.fsdAnalysis.total_autopilot_miles
                } : { error: "No recent drives found" }
              };

            default:
              return {
                query_understood: query,
                confidence: parsed.confidence,
                error: "Query understood but operation not yet implemented",
                parsed_operation: parsed.operation
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