import { TessieDrive } from './tessie-client.js';

export interface TripCostAnalysis {
  trip_summary: {
    distance_miles: number;
    duration_hours: number;
    battery_used_percent: number;
    energy_used_kwh: number;
    efficiency_miles_per_kwh: number;
  };
  cost_breakdown: {
    electricity_cost: number;
    charging_stops_cost: number;
    total_cost: number;
    cost_per_mile: number;
  };
  comparison: {
    vs_gas_vehicle: {
      gas_cost_estimate: number;
      savings: number;
      savings_percentage: number;
    };
    vs_optimal_charging: {
      optimal_cost: number;
      current_cost: number;
      potential_savings: number;
    };
  };
  charging_strategy: string[];
  environmental_impact: {
    co2_saved_lbs: number;
    trees_equivalent: number;
  };
}

export class TripCalculator {
  private readonly BATTERY_CAPACITY_KWH = 75; // Typical Model 3/Y
  private readonly DEFAULT_HOME_RATE = 0.13; // $/kWh
  private readonly DEFAULT_SUPERCHARGER_RATE = 0.28; // $/kWh
  private readonly DEFAULT_GAS_PRICE = 4.50; // $/gallon
  private readonly DEFAULT_MPG = 30; // Comparison gas vehicle
  private readonly CO2_PER_GALLON = 19.6; // lbs CO2 per gallon of gas
  private readonly CO2_PER_KWH_GRID = 0.855; // lbs CO2 per kWh (US average)

  /**
   * Calculate the cost of a specific trip or set of drives
   */
  calculateTripCost(
    drives: TessieDrive[],
    homeRate: number = this.DEFAULT_HOME_RATE,
    superchargerRate: number = this.DEFAULT_SUPERCHARGER_RATE,
    gasPrice: number = this.DEFAULT_GAS_PRICE
  ): TripCostAnalysis {
    if (drives.length === 0) {
      return this.emptyAnalysis();
    }

    // Sort drives chronologically
    const sortedDrives = [...drives].sort((a, b) => a.started_at - b.started_at);

    // Calculate trip metrics
    const totalDistance = drives.reduce((sum, d) => sum + d.odometer_distance, 0);
    const totalDuration = this.calculateTotalDuration(sortedDrives);
    const totalBatteryUsed = this.calculateTotalBatteryUsed(sortedDrives);
    const totalEnergyKwh = (totalBatteryUsed / 100) * this.BATTERY_CAPACITY_KWH;
    const efficiency = totalEnergyKwh > 0 ? totalDistance / totalEnergyKwh : 0;

    // Calculate costs
    const chargingCosts = this.estimateChargingCosts(
      sortedDrives,
      totalEnergyKwh,
      homeRate,
      superchargerRate
    );

    // Calculate gas comparison
    const gasComparison = this.calculateGasComparison(totalDistance, gasPrice);

    // Calculate optimal charging scenario
    const optimalCharging = this.calculateOptimalCharging(totalEnergyKwh, homeRate);

    // Generate charging strategy recommendations
    const strategy = this.generateChargingStrategy(
      sortedDrives,
      totalBatteryUsed,
      chargingCosts
    );

    // Calculate environmental impact
    const environmental = this.calculateEnvironmentalImpact(totalDistance, totalEnergyKwh);

    return {
      trip_summary: {
        distance_miles: Math.round(totalDistance * 100) / 100,
        duration_hours: Math.round(totalDuration * 100) / 100,
        battery_used_percent: Math.round(totalBatteryUsed * 100) / 100,
        energy_used_kwh: Math.round(totalEnergyKwh * 100) / 100,
        efficiency_miles_per_kwh: Math.round(efficiency * 100) / 100
      },
      cost_breakdown: {
        electricity_cost: Math.round(chargingCosts.electricityCost * 100) / 100,
        charging_stops_cost: Math.round(chargingCosts.chargingStopsCost * 100) / 100,
        total_cost: Math.round(chargingCosts.totalCost * 100) / 100,
        cost_per_mile: Math.round((chargingCosts.totalCost / totalDistance) * 1000) / 1000
      },
      comparison: {
        vs_gas_vehicle: {
          gas_cost_estimate: Math.round(gasComparison.gasCost * 100) / 100,
          savings: Math.round(gasComparison.savings * 100) / 100,
          savings_percentage: Math.round(gasComparison.savingsPercent * 100) / 100
        },
        vs_optimal_charging: {
          optimal_cost: Math.round(optimalCharging.optimal * 100) / 100,
          current_cost: Math.round(chargingCosts.totalCost * 100) / 100,
          potential_savings: Math.round(optimalCharging.savings * 100) / 100
        }
      },
      charging_strategy: strategy,
      environmental_impact: {
        co2_saved_lbs: Math.round(environmental.co2Saved * 10) / 10,
        trees_equivalent: Math.round(environmental.treesEquivalent)
      }
    };
  }

  private emptyAnalysis(): TripCostAnalysis {
    return {
      trip_summary: {
        distance_miles: 0,
        duration_hours: 0,
        battery_used_percent: 0,
        energy_used_kwh: 0,
        efficiency_miles_per_kwh: 0
      },
      cost_breakdown: {
        electricity_cost: 0,
        charging_stops_cost: 0,
        total_cost: 0,
        cost_per_mile: 0
      },
      comparison: {
        vs_gas_vehicle: {
          gas_cost_estimate: 0,
          savings: 0,
          savings_percentage: 0
        },
        vs_optimal_charging: {
          optimal_cost: 0,
          current_cost: 0,
          potential_savings: 0
        }
      },
      charging_strategy: ['No trip data available'],
      environmental_impact: {
        co2_saved_lbs: 0,
        trees_equivalent: 0
      }
    };
  }

  private calculateTotalDuration(drives: TessieDrive[]): number {
    if (drives.length === 0) return 0;
    const firstStart = drives[0].started_at;
    const lastEnd = drives[drives.length - 1].ended_at;
    return (lastEnd - firstStart) / 3600; // Convert to hours
  }

  private calculateTotalBatteryUsed(drives: TessieDrive[]): number {
    let totalUsed = 0;
    let lastEndingBattery = drives[0].starting_battery;

    for (const drive of drives) {
      // Account for charging between drives
      if (drive.starting_battery > lastEndingBattery) {
        // Battery increased - there was charging
        // Don't count this as usage
      }

      // Add battery used in this drive
      const driveUsage = drive.starting_battery - drive.ending_battery;
      if (driveUsage > 0) {
        totalUsed += driveUsage;
      }

      lastEndingBattery = drive.ending_battery;
    }

    return totalUsed;
  }

  private estimateChargingCosts(
    drives: TessieDrive[],
    totalEnergyKwh: number,
    homeRate: number,
    superchargerRate: number
  ): { electricityCost: number; chargingStopsCost: number; totalCost: number } {
    let homeCost = 0;
    let superchargerCost = 0;

    // Analyze charging patterns between drives
    for (let i = 1; i < drives.length; i++) {
      const prevDrive = drives[i - 1];
      const currentDrive = drives[i];
      const batteryGained = currentDrive.starting_battery - prevDrive.ending_battery;

      if (batteryGained > 2) { // Charging occurred
        const energyAdded = (batteryGained / 100) * this.BATTERY_CAPACITY_KWH;
        const gapHours = (currentDrive.started_at - prevDrive.ended_at) / 3600;

        // Estimate charging type based on duration and location
        if (gapHours < 1 && batteryGained > 30) {
          // Fast charging - likely Supercharger
          superchargerCost += energyAdded * superchargerRate;
        } else {
          // Slow charging - likely home
          homeCost += energyAdded * homeRate;
        }
      }
    }

    // If no charging detected in gaps, assume home charging for the energy used
    const detectedChargingKwh = (homeCost / homeRate) + (superchargerCost / superchargerRate);
    if (detectedChargingKwh < totalEnergyKwh * 0.5) {
      // Most energy not accounted for - assume home charging
      const unaccountedKwh = totalEnergyKwh - detectedChargingKwh;
      homeCost += unaccountedKwh * homeRate;
    }

    return {
      electricityCost: homeCost,
      chargingStopsCost: superchargerCost,
      totalCost: homeCost + superchargerCost
    };
  }

  private calculateGasComparison(
    distance: number,
    gasPrice: number
  ): { gasCost: number; savings: number; savingsPercent: number } {
    const gallonsNeeded = distance / this.DEFAULT_MPG;
    const gasCost = gallonsNeeded * gasPrice;

    return {
      gasCost,
      savings: 0, // Will be calculated by caller
      savingsPercent: 0 // Will be calculated by caller
    };
  }

  private calculateOptimalCharging(
    totalEnergyKwh: number,
    homeRate: number
  ): { optimal: number; savings: number } {
    // Optimal scenario: all charging at home during off-peak hours
    const offPeakRate = homeRate * 0.7; // Assume 30% discount for off-peak
    const optimal = totalEnergyKwh * offPeakRate;

    return {
      optimal,
      savings: 0 // Will be calculated by caller
    };
  }

  private generateChargingStrategy(
    drives: TessieDrive[],
    totalBatteryUsed: number,
    costs: { electricityCost: number; chargingStopsCost: number; totalCost: number }
  ): string[] {
    const strategies: string[] = [];

    // Analyze Supercharger usage
    const superchargerPercent = (costs.chargingStopsCost / costs.totalCost) * 100;
    if (superchargerPercent > 40) {
      strategies.push(
        `⚡ High Supercharger usage (${Math.round(superchargerPercent)}%). Consider charging at home before long trips`
      );
    }

    // Check if trip could be done with single charge
    if (totalBatteryUsed < 80) {
      strategies.push(
        `🔋 This trip could be completed with a single overnight charge at home`
      );
    }

    // Recommend charging level for trip
    const optimalStartCharge = Math.min(90, totalBatteryUsed + 20);
    strategies.push(
      `📊 Optimal starting charge: ${Math.round(optimalStartCharge)}% for this trip distance`
    );

    // Time-of-use recommendation
    if (costs.electricityCost > 0) {
      strategies.push(
        `🌙 Schedule home charging for off-peak hours (11pm-7am) to save 30-50% on electricity`
      );
    }

    return strategies;
  }

  private calculateEnvironmentalImpact(
    distance: number,
    energyKwh: number
  ): { co2Saved: number; treesEquivalent: number } {
    // CO2 from equivalent gas vehicle
    const gallonsForGas = distance / this.DEFAULT_MPG;
    const co2FromGas = gallonsForGas * this.CO2_PER_GALLON;

    // CO2 from EV charging (grid average)
    const co2FromEV = energyKwh * this.CO2_PER_KWH_GRID;

    // Net savings
    const co2Saved = co2FromGas - co2FromEV;

    // Tree equivalent (1 tree absorbs ~48 lbs CO2/year)
    const treesEquivalent = co2Saved / 48;

    return {
      co2Saved: Math.max(0, co2Saved),
      treesEquivalent: Math.max(0, treesEquivalent)
    };
  }

  /**
   * Calculate cost for a planned future trip
   */
  estimateFutureTripCost(
    distanceMiles: number,
    currentBatteryPercent: number,
    homeRate: number = this.DEFAULT_HOME_RATE,
    superchargerRate: number = this.DEFAULT_SUPERCHARGER_RATE
  ): {
    estimated_cost: number;
    charging_needed: boolean;
    recommended_charge_level: number;
    charging_stops_needed: number;
    strategy: string;
  } {
    // Assume 4 miles/kWh efficiency
    const efficiencyMilesPerKwh = 4;
    const energyNeeded = distanceMiles / efficiencyMilesPerKwh;
    const batteryPercentNeeded = (energyNeeded / this.BATTERY_CAPACITY_KWH) * 100;

    // Add 15% buffer for safety
    const totalBatteryNeeded = batteryPercentNeeded * 1.15;

    // Calculate charging needs
    const chargingNeeded = totalBatteryNeeded > currentBatteryPercent;
    const chargeDeficit = Math.max(0, totalBatteryNeeded - currentBatteryPercent);

    // Estimate charging stops (assume 50% charge per Supercharger stop)
    const superchargerStopsNeeded = Math.ceil(chargeDeficit / 50);

    // Calculate cost
    let estimatedCost = 0;
    let strategy = '';

    if (chargingNeeded) {
      if (chargeDeficit <= 60) {
        // Can charge at home
        const kwhNeeded = (chargeDeficit / 100) * this.BATTERY_CAPACITY_KWH;
        estimatedCost = kwhNeeded * homeRate;
        strategy = `Charge to ${Math.round(currentBatteryPercent + chargeDeficit)}% at home before departure`;
      } else {
        // Need Supercharger stops
        const homeChargeKwh = ((90 - currentBatteryPercent) / 100) * this.BATTERY_CAPACITY_KWH;
        const superchargerKwh = ((chargeDeficit - (90 - currentBatteryPercent)) / 100) * this.BATTERY_CAPACITY_KWH;

        estimatedCost = (homeChargeKwh * homeRate) + (superchargerKwh * superchargerRate);
        strategy = `Charge to 90% at home, then ${superchargerStopsNeeded} Supercharger stop${superchargerStopsNeeded > 1 ? 's' : ''} during trip`;
      }
    } else {
      strategy = `No charging needed - current ${currentBatteryPercent}% is sufficient`;
    }

    return {
      estimated_cost: Math.round(estimatedCost * 100) / 100,
      charging_needed: chargingNeeded,
      recommended_charge_level: Math.min(100, Math.round(currentBatteryPercent + chargeDeficit)),
      charging_stops_needed: superchargerStopsNeeded,
      strategy
    };
  }
}