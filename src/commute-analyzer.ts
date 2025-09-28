import { TessieDrive } from './tessie-client.js';

export interface CommuteRoute {
  id: string;
  name: string;
  from_location: string;
  to_location: string;
  typical_distance: number;
  frequency: number; // drives per week
  avg_duration_minutes: number;
  avg_efficiency_kwh_per_100mi: number;
  avg_battery_used: number;
  best_efficiency: number;
  worst_efficiency: number;
  recent_trend: 'improving' | 'declining' | 'stable';
  time_patterns: {
    morning_commute: { count: number; avg_time: string };
    evening_commute: { count: number; avg_time: string };
    weekend: { count: number; avg_time: string };
  };
}

export interface CommuteAnalysis {
  routes_detected: number;
  total_commute_miles: number;
  total_commute_cost: number;
  avg_commute_efficiency: number;
  routes: CommuteRoute[];
  recommendations: string[];
  weekly_summary: {
    total_drives: number;
    total_miles: number;
    total_cost: number;
    avg_efficiency: number;
    best_day: string;
    worst_day: string;
  };
}

export class CommuteAnalyzer {
  private readonly MIN_ROUTE_FREQUENCY = 3; // Minimum drives to consider a route
  private readonly LOCATION_SIMILARITY_THRESHOLD = 0.8; // How similar locations need to be
  private readonly HOME_RATE_PER_KWH = 0.13;

  /**
   * Detect and analyze commute patterns from driving history
   */
  analyzeCommutes(drives: TessieDrive[]): CommuteAnalysis {
    if (drives.length < 10) {
      return this.emptyAnalysis('Not enough driving data to detect commute patterns');
    }

    // Group drives by similar routes
    const routeGroups = this.groupDrivesByRoute(drives);

    // Filter for frequent routes (likely commutes)
    const commuteRoutes = routeGroups
      .filter(group => group.drives.length >= this.MIN_ROUTE_FREQUENCY)
      .map(group => this.analyzeRoute(group));

    // Calculate weekly summary
    const weeklySummary = this.calculateWeeklySummary(drives, commuteRoutes);

    // Generate recommendations
    const recommendations = this.generateCommuteRecommendations(commuteRoutes, weeklySummary);

    const totalCommuteMiles = commuteRoutes.reduce((sum, route) =>
      sum + (route.typical_distance * route.frequency), 0);

    const totalCommuteCost = this.calculateCommuteCost(totalCommuteMiles);

    return {
      routes_detected: commuteRoutes.length,
      total_commute_miles: Math.round(totalCommuteMiles * 100) / 100,
      total_commute_cost: Math.round(totalCommuteCost * 100) / 100,
      avg_commute_efficiency: this.calculateAvgEfficiency(commuteRoutes),
      routes: commuteRoutes,
      recommendations,
      weekly_summary: weeklySummary
    };
  }

  private emptyAnalysis(message: string): CommuteAnalysis {
    return {
      routes_detected: 0,
      total_commute_miles: 0,
      total_commute_cost: 0,
      avg_commute_efficiency: 0,
      routes: [],
      recommendations: [message],
      weekly_summary: {
        total_drives: 0,
        total_miles: 0,
        total_cost: 0,
        avg_efficiency: 0,
        best_day: 'N/A',
        worst_day: 'N/A'
      }
    };
  }

  private groupDrivesByRoute(drives: TessieDrive[]): Array<{ routeId: string; drives: TessieDrive[] }> {
    const routes = new Map<string, TessieDrive[]>();

    for (const drive of drives) {
      const routeId = this.generateRouteId(drive.starting_location, drive.ending_location);

      if (!routes.has(routeId)) {
        routes.set(routeId, []);
      }
      routes.get(routeId)!.push(drive);
    }

    return Array.from(routes.entries()).map(([routeId, drives]) => ({ routeId, drives }));
  }

  private generateRouteId(startLocation: string, endLocation: string): string {
    // Normalize locations by removing specific addresses and keeping general areas
    const normalizeLocation = (location: string): string => {
      // Extract city and state, remove specific street addresses
      const parts = location.split(',');
      if (parts.length >= 3) {
        return `${parts[parts.length - 3].trim()}, ${parts[parts.length - 2].trim()}`;
      }
      return location;
    };

    const start = normalizeLocation(startLocation);
    const end = normalizeLocation(endLocation);

    // Create consistent route ID regardless of direction
    return [start, end].sort().join(' ↔ ');
  }

  private analyzeRoute(routeGroup: { routeId: string; drives: TessieDrive[] }): CommuteRoute {
    const { drives } = routeGroup;
    const distances = drives.map(d => d.odometer_distance);
    const durations = drives.map(d => (d.ended_at - d.started_at) / 60); // minutes
    const batteryUsed = drives.map(d => d.starting_battery - d.ending_battery);

    // Calculate efficiency (kWh per 100 miles)
    const efficiencies = drives.map(d => {
      const distance = d.odometer_distance;
      const battery = d.starting_battery - d.ending_battery;
      if (distance === 0) return 0;
      return (battery / 100) * 75 / distance * 100; // Assuming 75kWh battery
    }).filter(e => e > 0 && e < 50); // Filter out unrealistic values

    // Analyze time patterns
    const timePatterns = this.analyzeTimePatterns(drives);

    // Calculate trend
    const recentTrend = this.calculateEfficiencyTrend(drives);

    // Generate route name
    const routeName = this.generateRouteName(drives[0]);

    return {
      id: routeGroup.routeId,
      name: routeName,
      from_location: drives[0].starting_location,
      to_location: drives[0].ending_location,
      typical_distance: this.average(distances),
      frequency: this.calculateWeeklyFrequency(drives),
      avg_duration_minutes: this.average(durations),
      avg_efficiency_kwh_per_100mi: this.average(efficiencies),
      avg_battery_used: this.average(batteryUsed),
      best_efficiency: Math.min(...efficiencies),
      worst_efficiency: Math.max(...efficiencies),
      recent_trend: recentTrend,
      time_patterns: timePatterns
    };
  }

  private generateRouteName(drive: TessieDrive): string {
    const extractCityName = (location: string): string => {
      const parts = location.split(',');
      if (parts.length >= 2) {
        return parts[parts.length - 3]?.trim() || parts[0].trim();
      }
      return location.split(' ')[0];
    };

    const startCity = extractCityName(drive.starting_location);
    const endCity = extractCityName(drive.ending_location);

    if (startCity === endCity) {
      return `${startCity} Local`;
    }

    return `${startCity} ↔ ${endCity}`;
  }

  private analyzeTimePatterns(drives: TessieDrive[]): CommuteRoute['time_patterns'] {
    const morningCommutes = drives.filter(d => {
      const hour = new Date(d.started_at * 1000).getHours();
      const day = new Date(d.started_at * 1000).getDay();
      return hour >= 6 && hour <= 10 && day >= 1 && day <= 5; // Weekday mornings
    });

    const eveningCommutes = drives.filter(d => {
      const hour = new Date(d.started_at * 1000).getHours();
      const day = new Date(d.started_at * 1000).getDay();
      return hour >= 15 && hour <= 19 && day >= 1 && day <= 5; // Weekday evenings
    });

    const weekendDrives = drives.filter(d => {
      const day = new Date(d.started_at * 1000).getDay();
      return day === 0 || day === 6; // Saturday or Sunday
    });

    return {
      morning_commute: {
        count: morningCommutes.length,
        avg_time: this.calculateAvgTime(morningCommutes)
      },
      evening_commute: {
        count: eveningCommutes.length,
        avg_time: this.calculateAvgTime(eveningCommutes)
      },
      weekend: {
        count: weekendDrives.length,
        avg_time: this.calculateAvgTime(weekendDrives)
      }
    };
  }

  private calculateAvgTime(drives: TessieDrive[]): string {
    if (drives.length === 0) return 'N/A';

    const avgTimestamp = drives.reduce((sum, d) => sum + d.started_at, 0) / drives.length;
    return new Date(avgTimestamp * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private calculateEfficiencyTrend(drives: TessieDrive[]): 'improving' | 'declining' | 'stable' {
    if (drives.length < 6) return 'stable';

    const sortedDrives = drives.sort((a, b) => a.started_at - b.started_at);
    const recentDrives = sortedDrives.slice(-6); // Last 6 drives
    const olderDrives = sortedDrives.slice(0, Math.min(6, drives.length - 6));

    if (olderDrives.length === 0) return 'stable';

    const recentEfficiency = this.calculateAvgEfficiencyForDrives(recentDrives);
    const olderEfficiency = this.calculateAvgEfficiencyForDrives(olderDrives);

    const improvement = ((olderEfficiency - recentEfficiency) / olderEfficiency) * 100;

    if (improvement > 5) return 'improving';
    if (improvement < -5) return 'declining';
    return 'stable';
  }

  private calculateAvgEfficiencyForDrives(drives: TessieDrive[]): number {
    const efficiencies = drives.map(d => {
      const distance = d.odometer_distance;
      const battery = d.starting_battery - d.ending_battery;
      if (distance === 0) return 0;
      return (battery / 100) * 75 / distance * 100;
    }).filter(e => e > 0 && e < 50);

    return this.average(efficiencies);
  }

  private calculateWeeklyFrequency(drives: TessieDrive[]): number {
    if (drives.length === 0) return 0;

    const sortedDrives = drives.sort((a, b) => a.started_at - b.started_at);
    const firstDrive = sortedDrives[0];
    const lastDrive = sortedDrives[sortedDrives.length - 1];

    const timeSpanWeeks = (lastDrive.started_at - firstDrive.started_at) / (7 * 24 * 3600);

    if (timeSpanWeeks === 0) return drives.length;

    return Math.round((drives.length / timeSpanWeeks) * 100) / 100;
  }

  private calculateWeeklySummary(drives: TessieDrive[], routes: CommuteRoute[]): CommuteAnalysis['weekly_summary'] {
    // Group drives by day of week
    const dailyStats = new Map<string, { drives: number; miles: number; efficiency: number }>();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    days.forEach(day => {
      dailyStats.set(day, { drives: 0, miles: 0, efficiency: 0 });
    });

    drives.forEach(drive => {
      const day = days[new Date(drive.started_at * 1000).getDay()];
      const stats = dailyStats.get(day)!;
      stats.drives++;
      stats.miles += drive.odometer_distance;

      const distance = drive.odometer_distance;
      const battery = drive.starting_battery - drive.ending_battery;
      if (distance > 0) {
        const efficiency = (battery / 100) * 75 / distance * 100;
        stats.efficiency = (stats.efficiency * (stats.drives - 1) + efficiency) / stats.drives;
      }
    });

    // Find best and worst days
    let bestDay = 'N/A';
    let worstDay = 'N/A';
    let bestEfficiency = Infinity;
    let worstEfficiency = 0;

    dailyStats.forEach((stats, day) => {
      if (stats.drives > 0) {
        if (stats.efficiency < bestEfficiency && stats.efficiency > 0) {
          bestEfficiency = stats.efficiency;
          bestDay = day;
        }
        if (stats.efficiency > worstEfficiency) {
          worstEfficiency = stats.efficiency;
          worstDay = day;
        }
      }
    });

    const totalMiles = drives.reduce((sum, d) => sum + d.odometer_distance, 0);
    const totalCost = this.calculateCommuteCost(totalMiles);
    const avgEfficiency = this.calculateAvgEfficiencyForDrives(drives);

    return {
      total_drives: drives.length,
      total_miles: Math.round(totalMiles * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      avg_efficiency: Math.round(avgEfficiency * 100) / 100,
      best_day: bestDay,
      worst_day: worstDay
    };
  }

  private generateCommuteRecommendations(routes: CommuteRoute[], summary: CommuteAnalysis['weekly_summary']): string[] {
    const recommendations: string[] = [];

    // Route-specific recommendations
    routes.forEach(route => {
      if (route.recent_trend === 'declining') {
        recommendations.push(
          `📉 ${route.name}: Efficiency declining recently. Check tire pressure and driving habits.`
        );
      }

      if (route.avg_efficiency_kwh_per_100mi > 30) {
        recommendations.push(
          `⚡ ${route.name}: High energy usage (${route.avg_efficiency_kwh_per_100mi.toFixed(1)} kWh/100mi). Try smoother acceleration and regenerative braking.`
        );
      }

      if (route.frequency > 10) {
        const weeklyCost = (route.typical_distance * route.frequency * route.avg_efficiency_kwh_per_100mi / 100) * this.HOME_RATE_PER_KWH;
        recommendations.push(
          `🚗 ${route.name}: Your most frequent route (${route.frequency.toFixed(1)}x/week, ~$${weeklyCost.toFixed(2)}/week)`
        );
      }
    });

    // General recommendations
    if (routes.length > 2) {
      recommendations.push(
        `📊 You have ${routes.length} regular routes. Consider optimizing departure times to avoid traffic for better efficiency.`
      );
    }

    // Best practices
    recommendations.push(
      '🔋 Pro tip: Pre-condition your car while plugged in to save battery on commutes.'
    );

    if (summary.best_day !== 'N/A' && summary.worst_day !== 'N/A') {
      recommendations.push(
        `📈 Best efficiency day: ${summary.best_day}. Worst: ${summary.worst_day}. Traffic patterns may be affecting your efficiency.`
      );
    }

    return recommendations;
  }

  private calculateCommuteCost(totalMiles: number): number {
    // Assume 4 mi/kWh efficiency and home charging rates
    const kwhUsed = totalMiles / 4;
    return kwhUsed * this.HOME_RATE_PER_KWH;
  }

  private calculateAvgEfficiency(routes: CommuteRoute[]): number {
    if (routes.length === 0) return 0;
    const total = routes.reduce((sum, route) => sum + route.avg_efficiency_kwh_per_100mi, 0);
    return Math.round((total / routes.length) * 100) / 100;
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return Math.round((sum / numbers.length) * 100) / 100;
  }
}