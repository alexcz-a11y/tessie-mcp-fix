#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TessieClient } from './tessie-client.js';
import { TessieQueryOptimizer } from './query-optimizer.js';
import { DriveAnalyzer } from './drive-analyzer.js';
import { ChargingAnalyzer } from './charging-analyzer.js';
import { TripCalculator } from './trip-calculator.js';
import { CommuteAnalyzer } from './commute-analyzer.js';
import { GeocodingService } from './geocoding.js';

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
    const chargingAnalyzer = new ChargingAnalyzer();
    const tripCalculator = new TripCalculator();
    const commuteAnalyzer = new CommuteAnalyzer();

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

          return {
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
              autopilot_distance: 0,
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
              error: 'No drives found in the specified period',
              suggestion: 'Try a longer date range or check if the vehicle has been driven recently'
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
          return {
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
              error: 'No drives found in the specified period',
              suggestion: 'Try a longer date range or check if the vehicle has been driven recently'
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

          return {
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

          return {
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
              error: 'Not enough driving data to detect commute patterns',
              drives_found: drives.length,
              suggestion: 'Try increasing days_back parameter or drive more regularly to establish patterns'
            };
          }

          const analysis = commuteAnalyzer.analyzeCommutes(drives);

          return {
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
        } catch (error) {
          throw new Error(`Failed to analyze commute patterns: ${error}`);
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