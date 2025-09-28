import { TessieDrive } from './tessie-client.js';

export interface EfficiencyDataPoint {
  date: string;
  efficiency_kwh_per_100mi: number;
  distance_miles: number;
  weather_factor?: 'hot' | 'cold' | 'mild';
  highway_percentage: number;
  avg_speed: number;
}

export interface EfficiencyTrend {
  period: string;
  trend_direction: 'improving' | 'declining' | 'stable';
  trend_percentage: number;
  avg_efficiency: number;
  best_efficiency: number;
  worst_efficiency: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface EfficiencyAnalysis {
  current_period: {
    avg_efficiency: number;
    total_miles: number;
    total_drives: number;
    efficiency_range: {
      best: number;
      worst: number;
    };
  };
  trends: {
    weekly: EfficiencyTrend;
    monthly: EfficiencyTrend;
    seasonal: EfficiencyTrend;
  };
  factors_analysis: {
    weather_impact: {
      hot_weather_penalty: number;
      cold_weather_penalty: number;
      optimal_temp_range: string;
    };
    speed_impact: {
      highway_efficiency: number;
      city_efficiency: number;
      optimal_speed_range: string;
    };
    time_patterns: {
      best_day_of_week: string;
      worst_day_of_week: string;
      best_time_of_day: string;
    };
  };
  recommendations: string[];
  insights: string[];
}

export class EfficiencyAnalyzer {
  private readonly BATTERY_CAPACITY_KWH = 75; // Typical Model 3/Y
  private readonly HIGHWAY_SPEED_THRESHOLD = 55; // mph

  /**
   * Analyze efficiency trends and patterns from driving history
   */
  analyzeEfficiencyTrends(drives: TessieDrive[]): EfficiencyAnalysis {
    if (drives.length < 5) {
      return this.emptyAnalysis('Insufficient driving data for trend analysis (minimum 5 drives required)');
    }

    // Sort drives chronologically
    const sortedDrives = drives.sort((a, b) => a.started_at - b.started_at);

    // Convert drives to efficiency data points
    const dataPoints = this.convertToDataPoints(sortedDrives);

    // Calculate current period stats
    const currentPeriod = this.calculateCurrentPeriodStats(dataPoints);

    // Analyze trends over different time periods
    const trends = this.calculateTrends(dataPoints);

    // Analyze factors affecting efficiency
    const factorsAnalysis = this.analyzeEfficiencyFactors(sortedDrives, dataPoints);

    // Generate insights and recommendations
    const insights = this.generateInsights(dataPoints, trends, factorsAnalysis);
    const recommendations = this.generateRecommendations(trends, factorsAnalysis);

    return {
      current_period: currentPeriod,
      trends,
      factors_analysis: factorsAnalysis,
      recommendations,
      insights
    };
  }

  private emptyAnalysis(message: string): EfficiencyAnalysis {
    const emptyTrend: EfficiencyTrend = {
      period: 'N/A',
      trend_direction: 'stable',
      trend_percentage: 0,
      avg_efficiency: 0,
      best_efficiency: 0,
      worst_efficiency: 0,
      confidence: 'low'
    };

    return {
      current_period: {
        avg_efficiency: 0,
        total_miles: 0,
        total_drives: 0,
        efficiency_range: { best: 0, worst: 0 }
      },
      trends: {
        weekly: emptyTrend,
        monthly: emptyTrend,
        seasonal: emptyTrend
      },
      factors_analysis: {
        weather_impact: {
          hot_weather_penalty: 0,
          cold_weather_penalty: 0,
          optimal_temp_range: 'Unknown'
        },
        speed_impact: {
          highway_efficiency: 0,
          city_efficiency: 0,
          optimal_speed_range: 'Unknown'
        },
        time_patterns: {
          best_day_of_week: 'Unknown',
          worst_day_of_week: 'Unknown',
          best_time_of_day: 'Unknown'
        }
      },
      recommendations: [message],
      insights: []
    };
  }

  private convertToDataPoints(drives: TessieDrive[]): EfficiencyDataPoint[] {
    return drives.map(drive => {
      const distance = drive.odometer_distance;
      const batteryUsed = drive.starting_battery - drive.ending_battery;
      const efficiency = distance > 0 ? (batteryUsed / 100) * this.BATTERY_CAPACITY_KWH / distance * 100 : 0;

      // Estimate highway percentage based on average speed
      const avgSpeed = drive.average_speed || 0;
      const highwayPercentage = avgSpeed > this.HIGHWAY_SPEED_THRESHOLD ?
        Math.min(100, (avgSpeed - 25) / 45 * 100) : 0;

      // Estimate weather factor based on efficiency patterns
      let weatherFactor: 'hot' | 'cold' | 'mild' = 'mild';
      if (efficiency > 35) weatherFactor = 'cold'; // High consumption suggests cold weather
      else if (efficiency > 30) weatherFactor = 'hot'; // Moderate high consumption suggests hot weather

      return {
        date: new Date(drive.started_at * 1000).toISOString().split('T')[0],
        efficiency_kwh_per_100mi: efficiency,
        distance_miles: distance,
        weather_factor: weatherFactor,
        highway_percentage: highwayPercentage,
        avg_speed: avgSpeed
      };
    }).filter(dp => dp.efficiency_kwh_per_100mi > 0 && dp.efficiency_kwh_per_100mi < 60); // Filter unrealistic values
  }

  private calculateCurrentPeriodStats(dataPoints: EfficiencyDataPoint[]) {
    const efficiencies = dataPoints.map(dp => dp.efficiency_kwh_per_100mi);
    const totalMiles = dataPoints.reduce((sum, dp) => sum + dp.distance_miles, 0);

    return {
      avg_efficiency: this.average(efficiencies),
      total_miles: Math.round(totalMiles * 100) / 100,
      total_drives: dataPoints.length,
      efficiency_range: {
        best: Math.min(...efficiencies),
        worst: Math.max(...efficiencies)
      }
    };
  }

  private calculateTrends(dataPoints: EfficiencyDataPoint[]): EfficiencyAnalysis['trends'] {
    const now = new Date();

    // Weekly trend (last 7 days vs previous 7 days)
    const weeklyTrend = this.calculatePeriodTrend(dataPoints, 7, 'weekly');

    // Monthly trend (last 30 days vs previous 30 days)
    const monthlyTrend = this.calculatePeriodTrend(dataPoints, 30, 'monthly');

    // Seasonal trend (last 90 days vs previous 90 days)
    const seasonalTrend = this.calculatePeriodTrend(dataPoints, 90, 'seasonal');

    return {
      weekly: weeklyTrend,
      monthly: monthlyTrend,
      seasonal: seasonalTrend
    };
  }

  private calculatePeriodTrend(dataPoints: EfficiencyDataPoint[], days: number, period: string): EfficiencyTrend {
    const now = new Date();
    const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const previousPeriodStart = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);

    const currentPeriodData = dataPoints.filter(dp =>
      new Date(dp.date) >= periodStart && new Date(dp.date) <= now
    );

    const previousPeriodData = dataPoints.filter(dp =>
      new Date(dp.date) >= previousPeriodStart && new Date(dp.date) < periodStart
    );

    if (currentPeriodData.length < 2 || previousPeriodData.length < 2) {
      return {
        period,
        trend_direction: 'stable',
        trend_percentage: 0,
        avg_efficiency: currentPeriodData.length > 0 ? this.average(currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi)) : 0,
        best_efficiency: currentPeriodData.length > 0 ? Math.min(...currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi)) : 0,
        worst_efficiency: currentPeriodData.length > 0 ? Math.max(...currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi)) : 0,
        confidence: 'low'
      };
    }

    const currentAvg = this.average(currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi));
    const previousAvg = this.average(previousPeriodData.map(dp => dp.efficiency_kwh_per_100mi));

    const trendPercentage = ((previousAvg - currentAvg) / previousAvg) * 100;

    let trendDirection: 'improving' | 'declining' | 'stable' = 'stable';
    if (trendPercentage > 3) trendDirection = 'improving'; // Lower consumption = better
    else if (trendPercentage < -3) trendDirection = 'declining'; // Higher consumption = worse

    const confidence = currentPeriodData.length >= 5 && previousPeriodData.length >= 5 ? 'high' :
                     currentPeriodData.length >= 3 && previousPeriodData.length >= 3 ? 'medium' : 'low';

    return {
      period,
      trend_direction: trendDirection,
      trend_percentage: Math.abs(trendPercentage),
      avg_efficiency: currentAvg,
      best_efficiency: Math.min(...currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi)),
      worst_efficiency: Math.max(...currentPeriodData.map(dp => dp.efficiency_kwh_per_100mi)),
      confidence
    };
  }

  private analyzeEfficiencyFactors(drives: TessieDrive[], dataPoints: EfficiencyDataPoint[]): EfficiencyAnalysis['factors_analysis'] {
    // Weather impact analysis
    const hotWeatherData = dataPoints.filter(dp => dp.weather_factor === 'hot');
    const coldWeatherData = dataPoints.filter(dp => dp.weather_factor === 'cold');
    const mildWeatherData = dataPoints.filter(dp => dp.weather_factor === 'mild');

    const mildAvg = mildWeatherData.length > 0 ? this.average(mildWeatherData.map(dp => dp.efficiency_kwh_per_100mi)) : 0;
    const hotAvg = hotWeatherData.length > 0 ? this.average(hotWeatherData.map(dp => dp.efficiency_kwh_per_100mi)) : mildAvg;
    const coldAvg = coldWeatherData.length > 0 ? this.average(coldWeatherData.map(dp => dp.efficiency_kwh_per_100mi)) : mildAvg;

    // Speed impact analysis
    const highwayData = dataPoints.filter(dp => dp.highway_percentage > 50);
    const cityData = dataPoints.filter(dp => dp.highway_percentage <= 50);

    const highwayEfficiency = highwayData.length > 0 ? this.average(highwayData.map(dp => dp.efficiency_kwh_per_100mi)) : 0;
    const cityEfficiency = cityData.length > 0 ? this.average(cityData.map(dp => dp.efficiency_kwh_per_100mi)) : 0;

    // Time pattern analysis
    const timePatterns = this.analyzeTimePatterns(drives, dataPoints);

    return {
      weather_impact: {
        hot_weather_penalty: mildAvg > 0 ? ((hotAvg - mildAvg) / mildAvg) * 100 : 0,
        cold_weather_penalty: mildAvg > 0 ? ((coldAvg - mildAvg) / mildAvg) * 100 : 0,
        optimal_temp_range: '65-75°F'
      },
      speed_impact: {
        highway_efficiency: Math.round(highwayEfficiency * 100) / 100,
        city_efficiency: Math.round(cityEfficiency * 100) / 100,
        optimal_speed_range: '45-65 mph'
      },
      time_patterns: timePatterns
    };
  }

  private analyzeTimePatterns(drives: TessieDrive[], dataPoints: EfficiencyDataPoint[]): EfficiencyAnalysis['factors_analysis']['time_patterns'] {
    // Group by day of week
    const dailyStats: { [key: string]: number[] } = {};
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    drives.forEach((drive, index) => {
      const dayOfWeek = days[new Date(drive.started_at * 1000).getDay()];
      if (!dailyStats[dayOfWeek]) dailyStats[dayOfWeek] = [];
      if (dataPoints[index]) {
        dailyStats[dayOfWeek].push(dataPoints[index].efficiency_kwh_per_100mi);
      }
    });

    // Find best and worst days
    let bestDay = 'Unknown';
    let worstDay = 'Unknown';
    let bestDayEfficiency = Infinity;
    let worstDayEfficiency = 0;

    Object.entries(dailyStats).forEach(([day, efficiencies]) => {
      if (efficiencies.length > 0) {
        const avgEfficiency = this.average(efficiencies);
        if (avgEfficiency < bestDayEfficiency) {
          bestDayEfficiency = avgEfficiency;
          bestDay = day;
        }
        if (avgEfficiency > worstDayEfficiency) {
          worstDayEfficiency = avgEfficiency;
          worstDay = day;
        }
      }
    });

    // Group by time of day
    const hourlyStats: { [key: number]: number[] } = {};
    drives.forEach((drive, index) => {
      const hour = new Date(drive.started_at * 1000).getHours();
      if (!hourlyStats[hour]) hourlyStats[hour] = [];
      if (dataPoints[index]) {
        hourlyStats[hour].push(dataPoints[index].efficiency_kwh_per_100mi);
      }
    });

    // Find best time of day
    let bestTime = 'Unknown';
    let bestTimeEfficiency = Infinity;
    Object.entries(hourlyStats).forEach(([hour, efficiencies]) => {
      if (efficiencies.length >= 2) {
        const avgEfficiency = this.average(efficiencies);
        if (avgEfficiency < bestTimeEfficiency) {
          bestTimeEfficiency = avgEfficiency;
          const h = parseInt(hour);
          bestTime = `${h === 0 ? 12 : h > 12 ? h - 12 : h}${h < 12 ? 'AM' : 'PM'}`;
        }
      }
    });

    return {
      best_day_of_week: bestDay,
      worst_day_of_week: worstDay,
      best_time_of_day: bestTime
    };
  }

  private generateInsights(dataPoints: EfficiencyDataPoint[], trends: EfficiencyAnalysis['trends'], factors: EfficiencyAnalysis['factors_analysis']): string[] {
    const insights: string[] = [];

    // Trend insights
    if (trends.weekly.confidence !== 'low') {
      if (trends.weekly.trend_direction === 'improving') {
        insights.push(`📈 Your efficiency has improved ${trends.weekly.trend_percentage.toFixed(1)}% this week - great driving habits!`);
      } else if (trends.weekly.trend_direction === 'declining') {
        insights.push(`📉 Your efficiency declined ${trends.weekly.trend_percentage.toFixed(1)}% this week - check driving patterns and tire pressure`);
      }
    }

    // Weather insights
    if (factors.weather_impact.cold_weather_penalty > 15) {
      insights.push(`🥶 Cold weather is significantly impacting efficiency (+${factors.weather_impact.cold_weather_penalty.toFixed(1)}% consumption)`);
    }
    if (factors.weather_impact.hot_weather_penalty > 10) {
      insights.push(`🔥 Hot weather and A/C usage is increasing consumption (+${factors.weather_impact.hot_weather_penalty.toFixed(1)}%)`);
    }

    // Speed insights
    if (factors.speed_impact.highway_efficiency > 0 && factors.speed_impact.city_efficiency > 0) {
      const diff = factors.speed_impact.highway_efficiency - factors.speed_impact.city_efficiency;
      if (Math.abs(diff) > 3) {
        if (diff > 0) {
          insights.push(`🏙️ City driving is ${Math.abs(diff).toFixed(1)} kWh/100mi more efficient than highway driving`);
        } else {
          insights.push(`🛣️ Highway driving is ${Math.abs(diff).toFixed(1)} kWh/100mi more efficient than city driving`);
        }
      }
    }

    // Time pattern insights
    if (factors.time_patterns.best_day_of_week !== 'Unknown' && factors.time_patterns.worst_day_of_week !== 'Unknown') {
      insights.push(`📅 Most efficient driving: ${factors.time_patterns.best_day_of_week}s. Least efficient: ${factors.time_patterns.worst_day_of_week}s`);
    }

    // Long-term trend insight
    if (trends.monthly.confidence === 'high') {
      if (trends.monthly.trend_direction === 'improving') {
        insights.push(`🎯 Monthly trend shows ${trends.monthly.trend_percentage.toFixed(1)}% efficiency improvement - your driving is optimizing!`);
      }
    }

    return insights;
  }

  private generateRecommendations(trends: EfficiencyAnalysis['trends'], factors: EfficiencyAnalysis['factors_analysis']): string[] {
    const recommendations: string[] = [];

    // Trend-based recommendations
    if (trends.weekly.trend_direction === 'declining' && trends.weekly.confidence !== 'low') {
      recommendations.push('⚡ Check tire pressure and reduce aggressive acceleration to improve efficiency');
      recommendations.push('🌡️ Use Eco mode in extreme weather conditions');
    }

    // Weather-based recommendations
    if (factors.weather_impact.cold_weather_penalty > 20) {
      recommendations.push('❄️ Pre-condition cabin while plugged in during cold weather');
      recommendations.push('🔋 Expect 15-25% reduced range in freezing temperatures');
    }
    if (factors.weather_impact.hot_weather_penalty > 15) {
      recommendations.push('☀️ Park in shade and use mobile app to pre-cool before driving');
      recommendations.push('🌬️ Use seat heaters instead of cabin heat when possible');
    }

    // Speed-based recommendations
    if (factors.speed_impact.highway_efficiency > factors.speed_impact.city_efficiency + 5) {
      recommendations.push('🏁 Reduce highway speeds to 65-70 mph for optimal efficiency');
      recommendations.push('🛣️ Use cruise control on highways to maintain consistent speed');
    }

    // General best practices
    recommendations.push('🚗 Maintain following distance to maximize regenerative braking');
    recommendations.push('📱 Monitor real-time efficiency display to develop efficient habits');

    // Time-based recommendations
    if (factors.time_patterns.best_day_of_week !== 'Unknown') {
      recommendations.push(`📅 Schedule non-urgent trips on ${factors.time_patterns.best_day_of_week}s for best efficiency`);
    }

    return recommendations;
  }

  private average(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sum = numbers.reduce((a, b) => a + b, 0);
    return Math.round((sum / numbers.length) * 100) / 100;
  }
}