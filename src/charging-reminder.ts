import { TessieVehicleState } from './tessie-client.js';

export interface ChargingReminder {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  type: 'range_warning' | 'optimal_charge' | 'time_of_use' | 'weather_prep' | 'trip_prep' | 'maintenance';
  title: string;
  message: string;
  action_required: boolean;
  estimated_savings?: string;
  time_sensitive?: boolean;
  deadline?: string;
}

export interface ChargingStrategy {
  current_status: {
    battery_level: number;
    charging_state: string;
    range_miles: number;
    plugged_in: boolean;
  };
  recommendations: ChargingReminder[];
  charging_schedule: {
    optimal_start_time: string;
    optimal_end_time: string;
    off_peak_window: string;
    estimated_cost_savings: number;
  };
  range_analysis: {
    comfort_range: boolean;
    emergency_range: boolean;
    recommended_charge_level: number;
    next_charge_needed: string;
  };
  smart_insights: string[];
}

export class ChargingReminderSystem {
  private readonly COMFORT_RANGE_THRESHOLD = 50; // miles
  private readonly EMERGENCY_RANGE_THRESHOLD = 20; // miles
  private readonly OPTIMAL_CHARGE_LEVEL = 80; // %
  private readonly DAILY_CHARGE_LEVEL = 90; // %
  private readonly COLD_WEATHER_THRESHOLD = 32; // °F
  private readonly HOT_WEATHER_THRESHOLD = 85; // °F
  private readonly OFF_PEAK_START = 23; // 11 PM
  private readonly OFF_PEAK_END = 7; // 7 AM
  private readonly PEAK_RATE = 0.35; // $/kWh
  private readonly OFF_PEAK_RATE = 0.13; // $/kWh

  /**
   * Generate intelligent charging reminders and strategy
   */
  generateChargingStrategy(
    vehicleState: TessieVehicleState,
    dailyMiles: number = 40,
    nextTripDistance?: number,
    weatherTemp?: number
  ): ChargingStrategy {
    const batteryLevel = vehicleState.battery_level || 0;
    const rangeMiles = vehicleState.battery_range || 0;
    const chargingState = vehicleState.charging_state || 'Disconnected';
    const pluggedIn = chargingState !== 'Disconnected' && chargingState !== 'Complete';

    // Generate reminders based on current state
    const recommendations = this.generateReminders(
      vehicleState,
      dailyMiles,
      nextTripDistance,
      weatherTemp
    );

    // Calculate optimal charging schedule
    const chargingSchedule = this.calculateOptimalSchedule(batteryLevel, dailyMiles);

    // Analyze range situation
    const rangeAnalysis = this.analyzeRange(batteryLevel, rangeMiles, dailyMiles, nextTripDistance);

    // Generate smart insights
    const smartInsights = this.generateSmartInsights(
      vehicleState,
      batteryLevel,
      rangeMiles,
      dailyMiles,
      weatherTemp
    );

    return {
      current_status: {
        battery_level: batteryLevel,
        charging_state: chargingState,
        range_miles: Math.round(rangeMiles),
        plugged_in: pluggedIn
      },
      recommendations: recommendations.sort((a, b) => this.getPriorityWeight(a.priority) - this.getPriorityWeight(b.priority)),
      charging_schedule: chargingSchedule,
      range_analysis: rangeAnalysis,
      smart_insights: smartInsights
    };
  }

  private generateReminders(
    vehicleState: TessieVehicleState,
    dailyMiles: number,
    nextTripDistance?: number,
    weatherTemp?: number
  ): ChargingReminder[] {
    const reminders: ChargingReminder[] = [];
    const batteryLevel = vehicleState.battery_level || 0;
    const rangeMiles = vehicleState.battery_range || 0;
    const chargingState = vehicleState.charging_state || 'Disconnected';
    const isHome = this.isHomeLocation(vehicleState);

    // Critical range warnings
    if (rangeMiles < this.EMERGENCY_RANGE_THRESHOLD) {
      reminders.push({
        priority: 'urgent',
        type: 'range_warning',
        title: '🚨 Critical Range Alert',
        message: `Only ${Math.round(rangeMiles)} miles remaining. Find charging immediately!`,
        action_required: true,
        time_sensitive: true,
        deadline: 'ASAP'
      });
    } else if (rangeMiles < this.COMFORT_RANGE_THRESHOLD) {
      reminders.push({
        priority: 'high',
        type: 'range_warning',
        title: '⚠️ Low Range Warning',
        message: `${Math.round(rangeMiles)} miles remaining. Plan charging for today.`,
        action_required: true,
        time_sensitive: true,
        deadline: 'Today'
      });
    }

    // Optimal charging reminders
    if (isHome && chargingState === 'Disconnected' && batteryLevel < this.OPTIMAL_CHARGE_LEVEL) {
      const chargeNeeded = this.OPTIMAL_CHARGE_LEVEL - batteryLevel;
      const savings = this.calculateOffPeakSavings(chargeNeeded);

      reminders.push({
        priority: batteryLevel < 30 ? 'high' : 'medium',
        type: 'optimal_charge',
        title: '🔌 Plug In Recommended',
        message: `Battery at ${batteryLevel}%. Charge to ${this.OPTIMAL_CHARGE_LEVEL}% during off-peak hours.`,
        action_required: true,
        estimated_savings: `$${savings.toFixed(2)}/charge`,
        time_sensitive: false
      });
    }

    // Time-of-use optimization
    if (chargingState === 'Charging' && this.isDuringPeakHours()) {
      const savings = this.calculateOffPeakSavings(20); // Assume 20% charge
      reminders.push({
        priority: 'medium',
        type: 'time_of_use',
        title: '💰 Peak Hour Charging Alert',
        message: 'Currently charging during peak rates. Consider scheduling for off-peak hours.',
        action_required: false,
        estimated_savings: `$${savings.toFixed(2)}/session`,
        time_sensitive: true
      });
    }

    // Weather preparation
    if (weatherTemp !== undefined) {
      if (weatherTemp < this.COLD_WEATHER_THRESHOLD && batteryLevel < 90) {
        reminders.push({
          priority: 'medium',
          type: 'weather_prep',
          title: '❄️ Cold Weather Prep',
          message: `Freezing weather ahead (${weatherTemp}°F). Charge to 90% and precondition cabin.`,
          action_required: true,
          time_sensitive: true,
          deadline: 'Before tomorrow'
        });
      } else if (weatherTemp > this.HOT_WEATHER_THRESHOLD && batteryLevel < 85) {
        reminders.push({
          priority: 'medium',
          type: 'weather_prep',
          title: '🔥 Hot Weather Prep',
          message: `High temperatures forecast (${weatherTemp}°F). Charge to 85% and precondition.`,
          action_required: true,
          time_sensitive: true,
          deadline: 'Before peak heat'
        });
      }
    }

    // Trip preparation
    if (nextTripDistance && nextTripDistance > 0) {
      const requiredRange = nextTripDistance * 1.3; // 30% buffer
      if (rangeMiles < requiredRange) {
        const chargeNeeded = Math.ceil((requiredRange - rangeMiles) / 3); // ~3 miles per %
        reminders.push({
          priority: 'high',
          type: 'trip_prep',
          title: '🛣️ Trip Charging Required',
          message: `${nextTripDistance}-mile trip needs ${chargeNeeded}% more charge. Plan charging stops if needed.`,
          action_required: true,
          time_sensitive: true,
          deadline: 'Before departure'
        });
      }
    }

    // Daily routine reminders
    const rangeForTomorrow = rangeMiles - dailyMiles;
    if (rangeForTomorrow < this.COMFORT_RANGE_THRESHOLD && isHome) {
      reminders.push({
        priority: 'medium',
        type: 'optimal_charge',
        title: '🌅 Daily Routine Charging',
        message: `Tomorrow's commute (~${dailyMiles} mi) will leave ${Math.round(rangeForTomorrow)} miles. Plug in tonight.`,
        action_required: true,
        time_sensitive: false
      });
    }

    // Maintenance reminders
    if (batteryLevel === 100 && chargingState === 'Complete') {
      reminders.push({
        priority: 'low',
        type: 'maintenance',
        title: '🔋 Battery Health Tip',
        message: 'Avoid keeping battery at 100% unless needed for long trips. Consider setting daily limit to 80%.',
        action_required: false,
        time_sensitive: false
      });
    }

    return reminders;
  }

  private calculateOptimalSchedule(batteryLevel: number, dailyMiles: number): ChargingStrategy['charging_schedule'] {
    // Calculate charge needed for daily routine plus buffer
    const rangeNeeded = dailyMiles * 1.5; // 50% buffer
    const chargeNeeded = Math.max(0, this.OPTIMAL_CHARGE_LEVEL - batteryLevel);

    // Estimate charging time (assume Level 2 charging ~25 miles/hour)
    const chargingHours = Math.ceil(chargeNeeded * 3 / 25); // Rough estimate

    // Calculate optimal off-peak window
    const optimalStart = Math.max(this.OFF_PEAK_START, 23);
    const optimalEnd = Math.min(this.OFF_PEAK_END + chargingHours, 7);

    const savings = this.calculateOffPeakSavings(chargeNeeded);

    return {
      optimal_start_time: `${optimalStart === 23 ? 11 : optimalStart}:00 PM`,
      optimal_end_time: `${optimalEnd}:00 AM`,
      off_peak_window: `11:00 PM - 7:00 AM`,
      estimated_cost_savings: Math.round(savings * 100) / 100
    };
  }

  private analyzeRange(
    batteryLevel: number,
    rangeMiles: number,
    dailyMiles: number,
    nextTripDistance?: number
  ): ChargingStrategy['range_analysis'] {
    const comfortRange = rangeMiles > this.COMFORT_RANGE_THRESHOLD;
    const emergencyRange = rangeMiles < this.EMERGENCY_RANGE_THRESHOLD;

    // Calculate recommended charge level
    let recommendedLevel = this.OPTIMAL_CHARGE_LEVEL;
    if (nextTripDistance && nextTripDistance > 200) {
      recommendedLevel = Math.min(100, 90); // Long trip preparation
    } else if (dailyMiles > 60) {
      recommendedLevel = this.DAILY_CHARGE_LEVEL; // High daily usage
    }

    // Estimate when next charge is needed
    const rangeAfterDailyDriving = rangeMiles - dailyMiles;
    let nextChargeNeeded = 'Not needed';
    if (rangeAfterDailyDriving < this.COMFORT_RANGE_THRESHOLD) {
      nextChargeNeeded = 'Tonight';
    } else if (rangeAfterDailyDriving < dailyMiles * 2) {
      nextChargeNeeded = 'Tomorrow evening';
    } else {
      const daysUntilCharge = Math.floor(rangeAfterDailyDriving / dailyMiles);
      nextChargeNeeded = `In ${daysUntilCharge} days`;
    }

    return {
      comfort_range: comfortRange,
      emergency_range: emergencyRange,
      recommended_charge_level: recommendedLevel,
      next_charge_needed: nextChargeNeeded
    };
  }

  private generateSmartInsights(
    vehicleState: TessieVehicleState,
    batteryLevel: number,
    rangeMiles: number,
    dailyMiles: number,
    weatherTemp?: number
  ): string[] {
    const insights: string[] = [];
    const chargingState = vehicleState.charging_state || 'Disconnected';

    // Charging efficiency insights
    if (chargingState === 'Charging') {
      if (this.isDuringPeakHours()) {
        insights.push('💸 Charging during peak hours costs ~170% more than off-peak rates');
      } else {
        insights.push('💚 Great timing! Off-peak charging saves $2-5 per session');
      }
    }

    // Battery level insights
    if (batteryLevel > 95) {
      insights.push('🔋 Consider setting daily charge limit to 80% to optimize battery longevity');
    } else if (batteryLevel < 20) {
      insights.push('⚡ Low battery increases phantom drain - charge soon to maintain efficiency');
    }

    // Range vs usage insights
    const daysOfRange = Math.floor(rangeMiles / dailyMiles);
    if (daysOfRange >= 5) {
      insights.push(`🎯 Current range covers ${daysOfRange} days of typical driving - you're well prepared`);
    } else if (daysOfRange <= 1) {
      insights.push('📅 Less than 2 days of range remaining - plan charging today');
    }

    // Weather impact insights
    if (weatherTemp !== undefined) {
      if (weatherTemp < 32) {
        insights.push('❄️ Cold weather reduces range ~20-30% - factor this into trip planning');
      } else if (weatherTemp > 85) {
        insights.push('🌡️ Hot weather increases A/C usage - expect 10-15% range reduction');
      } else {
        insights.push('🌤️ Mild weather conditions optimal for efficiency and range');
      }
    }

    // Charging pattern insights
    if (batteryLevel < 50 && chargingState === 'Disconnected') {
      insights.push('🔌 Plugging in now would complete charging during off-peak hours tonight');
    }

    return insights;
  }

  private isHomeLocation(vehicleState: TessieVehicleState): boolean {
    // Simple heuristic: if the car is parked and not at a known charging location
    // In a real implementation, this would check against user's home coordinates
    const speed = vehicleState.speed || 0;
    return speed === 0; // Simplified - assume stationary = home
  }

  private isDuringPeakHours(): boolean {
    const hour = new Date().getHours();
    return hour >= 16 && hour <= 21; // 4 PM - 9 PM peak hours
  }

  private calculateOffPeakSavings(chargePercent: number): number {
    // Estimate kWh for charge percentage (assuming 75kWh battery)
    const kwhNeeded = (chargePercent / 100) * 75;
    const peakCost = kwhNeeded * this.PEAK_RATE;
    const offPeakCost = kwhNeeded * this.OFF_PEAK_RATE;
    return peakCost - offPeakCost;
  }

  private getPriorityWeight(priority: ChargingReminder['priority']): number {
    const weights = { urgent: 1, high: 2, medium: 3, low: 4 };
    return weights[priority];
  }
}