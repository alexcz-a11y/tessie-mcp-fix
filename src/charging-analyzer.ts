import { TessieClient, TessieDrive } from './tessie-client.js';

export interface ChargingSession {
  id: string;
  started_at: number;
  ended_at: number;
  location: string;
  location_type: 'home' | 'work' | 'supercharger' | 'public' | 'unknown';
  starting_battery: number;
  ending_battery: number;
  energy_added_kwh: number;
  cost_estimate: number;
  cost_per_kwh: number;
  miles_added: number;
  charge_rate_kw?: number;
  duration_minutes: number;
}

export interface ChargingAnalysis {
  total_sessions: number;
  total_cost: number;
  total_kwh: number;
  total_miles_added: number;
  average_cost_per_session: number;
  average_cost_per_kwh: number;
  average_cost_per_mile: number;
  sessions_by_location: {
    home: { sessions: number; cost: number; kwh: number };
    supercharger: { sessions: number; cost: number; kwh: number };
    public: { sessions: number; cost: number; kwh: number };
    work: { sessions: number; cost: number; kwh: number };
    unknown: { sessions: number; cost: number; kwh: number };
  };
  recommendations: string[];
  potential_savings: number;
}

export interface ChargeRates {
  home_rate_per_kwh: number;
  supercharger_rate_per_kwh: number;
  public_rate_per_kwh: number;
  work_rate_per_kwh: number;
  time_of_use?: {
    off_peak: { hours: string; rate: number };
    peak: { hours: string; rate: number };
  };
}

export class ChargingAnalyzer {
  private defaultRates: ChargeRates = {
    home_rate_per_kwh: 0.13,           // US average residential
    supercharger_rate_per_kwh: 0.28,   // Typical Supercharger rate
    public_rate_per_kwh: 0.20,         // Average public charger
    work_rate_per_kwh: 0.0,            // Often free at work
    time_of_use: {
      off_peak: { hours: '23:00-07:00', rate: 0.09 },
      peak: { hours: '16:00-21:00', rate: 0.32 }
    }
  };

  private homeLocations: Set<string> = new Set();
  private workLocations: Set<string> = new Set();
  private frequentLocations: Map<string, number> = new Map();

  constructor(private customRates?: Partial<ChargeRates>) {
    if (customRates) {
      this.defaultRates = { ...this.defaultRates, ...customRates };
    }
  }

  /**
   * Detect charging sessions from drive data by looking for battery increases
   */
  detectChargingSessions(drives: TessieDrive[]): ChargingSession[] {
    const sessions: ChargingSession[] = [];

    // Sort drives by time
    const sortedDrives = [...drives].sort((a, b) => a.started_at - b.started_at);

    for (let i = 1; i < sortedDrives.length; i++) {
      const prevDrive = sortedDrives[i - 1];
      const currentDrive = sortedDrives[i];

      // Check if battery increased between drives (indicating charging)
      const batteryGained = currentDrive.starting_battery - prevDrive.ending_battery;

      if (batteryGained > 2) { // More than 2% gain indicates charging
        const session = this.createChargingSession(prevDrive, currentDrive, batteryGained);
        sessions.push(session);
      }
    }

    return sessions;
  }

  private createChargingSession(prevDrive: TessieDrive, nextDrive: TessieDrive, batteryGained: number): ChargingSession {
    const duration = (nextDrive.started_at - prevDrive.ended_at) / 60; // minutes
    const location = prevDrive.ending_location;
    const locationType = this.classifyLocation(location, duration, batteryGained);

    // Estimate kWh added (assuming ~75kWh battery capacity)
    const batteryCapacity = 75; // kWh - typical Model 3/Y
    const energyAdded = (batteryGained / 100) * batteryCapacity;

    // Estimate charge rate
    const chargeRate = duration > 0 ? (energyAdded / (duration / 60)) : 0;

    // Calculate cost based on location type and rates
    const costPerKwh = this.getRateForLocation(locationType, prevDrive.ended_at);
    const cost = energyAdded * costPerKwh;

    // Estimate miles added (using typical efficiency of 4 miles/kWh)
    const milesAdded = energyAdded * 4;

    return {
      id: `charge_${prevDrive.id}_${nextDrive.id}`,
      started_at: prevDrive.ended_at,
      ended_at: nextDrive.started_at,
      location,
      location_type: locationType,
      starting_battery: prevDrive.ending_battery,
      ending_battery: nextDrive.starting_battery,
      energy_added_kwh: Math.round(energyAdded * 100) / 100,
      cost_estimate: Math.round(cost * 100) / 100,
      cost_per_kwh: costPerKwh,
      miles_added: Math.round(milesAdded * 100) / 100,
      charge_rate_kw: Math.round(chargeRate * 10) / 10,
      duration_minutes: Math.round(duration * 100) / 100
    };
  }

  private classifyLocation(location: string, duration: number, batteryGained: number): ChargingSession['location_type'] {
    const lowerLocation = location.toLowerCase();

    // Supercharger detection
    if (lowerLocation.includes('supercharger') || lowerLocation.includes('tesla')) {
      return 'supercharger';
    }

    // Fast charging characteristics (high charge rate)
    if (duration < 60 && batteryGained > 40) {
      return 'supercharger';
    }

    // Check against known home locations
    if (this.homeLocations.has(location)) {
      return 'home';
    }

    // Check against known work locations
    if (this.workLocations.has(location)) {
      return 'work';
    }

    // Long duration charging (likely home or work)
    if (duration > 240) { // More than 4 hours
      // Update frequent locations
      const count = this.frequentLocations.get(location) || 0;
      this.frequentLocations.set(location, count + 1);

      if (count > 5) { // Frequent location, likely home
        this.homeLocations.add(location);
        return 'home';
      }
      return duration > 480 ? 'home' : 'work'; // 8+ hours likely home
    }

    // Public charger characteristics
    if (duration > 30 && duration < 240) {
      return 'public';
    }

    return 'unknown';
  }

  private getRateForLocation(locationType: ChargingSession['location_type'], timestamp: number): number {
    const hour = new Date(timestamp * 1000).getHours();

    switch (locationType) {
      case 'home':
        // Apply time-of-use rates if available
        if (this.defaultRates.time_of_use) {
          if (hour >= 23 || hour < 7) {
            return this.defaultRates.time_of_use.off_peak.rate;
          }
          if (hour >= 16 && hour < 21) {
            return this.defaultRates.time_of_use.peak.rate;
          }
        }
        return this.defaultRates.home_rate_per_kwh;

      case 'supercharger':
        return this.defaultRates.supercharger_rate_per_kwh;

      case 'public':
        return this.defaultRates.public_rate_per_kwh;

      case 'work':
        return this.defaultRates.work_rate_per_kwh;

      default:
        return this.defaultRates.public_rate_per_kwh;
    }
  }

  /**
   * Analyze charging patterns and costs
   */
  analyzeChargingCosts(sessions: ChargingSession[]): ChargingAnalysis {
    if (sessions.length === 0) {
      return {
        total_sessions: 0,
        total_cost: 0,
        total_kwh: 0,
        total_miles_added: 0,
        average_cost_per_session: 0,
        average_cost_per_kwh: 0,
        average_cost_per_mile: 0,
        sessions_by_location: {
          home: { sessions: 0, cost: 0, kwh: 0 },
          supercharger: { sessions: 0, cost: 0, kwh: 0 },
          public: { sessions: 0, cost: 0, kwh: 0 },
          work: { sessions: 0, cost: 0, kwh: 0 },
          unknown: { sessions: 0, cost: 0, kwh: 0 }
        },
        recommendations: ['No charging sessions found in the selected period'],
        potential_savings: 0
      };
    }

    // Calculate totals
    const totalCost = sessions.reduce((sum, s) => sum + s.cost_estimate, 0);
    const totalKwh = sessions.reduce((sum, s) => sum + s.energy_added_kwh, 0);
    const totalMiles = sessions.reduce((sum, s) => sum + s.miles_added, 0);

    // Group by location type
    const sessionsByLocation = {
      home: { sessions: 0, cost: 0, kwh: 0 },
      supercharger: { sessions: 0, cost: 0, kwh: 0 },
      public: { sessions: 0, cost: 0, kwh: 0 },
      work: { sessions: 0, cost: 0, kwh: 0 },
      unknown: { sessions: 0, cost: 0, kwh: 0 }
    };

    sessions.forEach(session => {
      const loc = sessionsByLocation[session.location_type];
      loc.sessions++;
      loc.cost += session.cost_estimate;
      loc.kwh += session.energy_added_kwh;
    });

    // Generate recommendations
    const recommendations = this.generateRecommendations(sessions, sessionsByLocation);
    const potentialSavings = this.calculatePotentialSavings(sessions, sessionsByLocation);

    return {
      total_sessions: sessions.length,
      total_cost: Math.round(totalCost * 100) / 100,
      total_kwh: Math.round(totalKwh * 100) / 100,
      total_miles_added: Math.round(totalMiles * 100) / 100,
      average_cost_per_session: Math.round((totalCost / sessions.length) * 100) / 100,
      average_cost_per_kwh: Math.round((totalCost / totalKwh) * 100) / 100,
      average_cost_per_mile: Math.round((totalCost / totalMiles) * 1000) / 1000,
      sessions_by_location: sessionsByLocation,
      recommendations,
      potential_savings: Math.round(potentialSavings * 100) / 100
    };
  }

  private generateRecommendations(sessions: ChargingSession[], byLocation: any): string[] {
    const recommendations: string[] = [];

    // Check supercharger usage
    const superchargerPercent = (byLocation.supercharger.cost / sessions.reduce((sum, s) => sum + s.cost_estimate, 0)) * 100;
    if (superchargerPercent > 30) {
      recommendations.push(`💡 ${Math.round(superchargerPercent)}% of charging costs are from Superchargers. Increase home charging to save ~$${Math.round(byLocation.supercharger.cost * 0.5)}/month`);
    }

    // Check for peak hour charging at home
    const peakHourSessions = sessions.filter(s => {
      const hour = new Date(s.started_at * 1000).getHours();
      return s.location_type === 'home' && hour >= 16 && hour < 21;
    });
    if (peakHourSessions.length > 0) {
      const peakCost = peakHourSessions.reduce((sum, s) => sum + s.cost_estimate, 0);
      recommendations.push(`⚡ Shift ${peakHourSessions.length} peak-hour charging sessions to overnight to save ~$${Math.round(peakCost * 0.6)}/month`);
    }

    // Check charging efficiency
    const avgChargeRate = sessions.reduce((sum, s) => sum + (s.charge_rate_kw || 0), 0) / sessions.length;
    if (avgChargeRate < 7 && byLocation.home.sessions > 0) {
      recommendations.push(`🔌 Your average home charge rate is ${avgChargeRate.toFixed(1)}kW. Consider installing a Level 2 charger for faster charging`);
    }

    // Free charging opportunities
    if (byLocation.work.sessions === 0 && sessions.length > 10) {
      recommendations.push(`🏢 No workplace charging detected. Check if your employer offers free EV charging`);
    }

    return recommendations.length > 0 ? recommendations : ['✅ Your charging strategy is well optimized!'];
  }

  private calculatePotentialSavings(sessions: ChargingSession[], byLocation: any): number {
    let savings = 0;

    // Savings from shifting Supercharger to home
    const superchargerKwh = byLocation.supercharger.kwh;
    const homeRate = this.defaultRates.time_of_use?.off_peak.rate || this.defaultRates.home_rate_per_kwh;
    savings += superchargerKwh * (this.defaultRates.supercharger_rate_per_kwh - homeRate) * 0.5; // Assume 50% can be shifted

    // Savings from time-of-use optimization
    const peakSessions = sessions.filter(s => {
      const hour = new Date(s.started_at * 1000).getHours();
      return s.location_type === 'home' && hour >= 16 && hour < 21;
    });
    const peakKwh = peakSessions.reduce((sum, s) => sum + s.energy_added_kwh, 0);
    if (this.defaultRates.time_of_use) {
      savings += peakKwh * (this.defaultRates.time_of_use.peak.rate - this.defaultRates.time_of_use.off_peak.rate);
    }

    return savings;
  }

  /**
   * Learn home and work locations from patterns
   */
  learnLocations(drives: TessieDrive[]) {
    const locationFrequency = new Map<string, { count: number; overnight: number; duration: number }>();

    for (let i = 1; i < drives.length; i++) {
      const prevDrive = drives[i - 1];
      const nextDrive = drives[i];
      const location = prevDrive.ending_location;
      const duration = (nextDrive.started_at - prevDrive.ended_at) / 3600; // hours

      const stats = locationFrequency.get(location) || { count: 0, overnight: 0, duration: 0 };
      stats.count++;
      stats.duration += duration;

      // Check if overnight
      const endHour = new Date(prevDrive.ended_at * 1000).getHours();
      const startHour = new Date(nextDrive.started_at * 1000).getHours();
      if ((endHour > 20 || endHour < 6) && duration > 6) {
        stats.overnight++;
      }

      locationFrequency.set(location, stats);
    }

    // Identify home (most overnight stays)
    let maxOvernights = 0;
    let homeLocation = '';
    locationFrequency.forEach((stats, location) => {
      if (stats.overnight > maxOvernights) {
        maxOvernights = stats.overnight;
        homeLocation = location;
      }
    });
    if (homeLocation) {
      this.homeLocations.add(homeLocation);
    }

    // Identify work (frequent daytime long stays)
    locationFrequency.forEach((stats, location) => {
      if (stats.count > 10 && stats.duration / stats.count > 6 && !this.homeLocations.has(location)) {
        this.workLocations.add(location);
      }
    });
  }
}