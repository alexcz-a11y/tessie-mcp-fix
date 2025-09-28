import { TessieDrive } from './tessie-client.js';

export interface MergedDrive {
  id: string; // Composite ID of merged drives
  originalDriveIds: number[];
  started_at: number;
  ended_at: number;
  starting_location: string;
  ending_location: string;
  starting_battery: number;
  ending_battery: number;
  total_distance: number;
  total_duration_minutes: number;
  driving_duration_minutes: number;
  stops: DriveStop[];
  autopilot_distance: number;
  autopilot_percentage: number;
  energy_consumed: number;
  average_speed: number;
  max_speed: number;
}

export interface DriveStop {
  location: string;
  duration_minutes: number;
  stop_type: 'short' | 'charging' | 'excluded';
  started_at: number;
  ended_at: number;
}

export interface DriveAnalysis {
  mergedDrive: MergedDrive;
  batteryConsumption: {
    percentage_used: number;
    estimated_kwh_used: number;
    efficiency_miles_per_kwh?: number;
  };
  fsdAnalysis: {
    total_autopilot_miles: number;
    fsd_percentage: number;
    autopilot_available: boolean;
    note?: string;
  };
  summary: string;
}

export class DriveAnalyzer {
  /**
   * Merges consecutive drives that are separated by stops less than 7 minutes
   * or charging stops, treating them as a single continuous journey
   */
  mergeDrives(drives: TessieDrive[]): MergedDrive[] {
    if (drives.length === 0) return [];

    // Sort drives by start time
    const sortedDrives = [...drives].sort((a, b) => a.started_at - b.started_at);
    const mergedDrives: MergedDrive[] = [];
    let currentGroup: TessieDrive[] = [sortedDrives[0]];

    for (let i = 1; i < sortedDrives.length; i++) {
      const prevDrive = sortedDrives[i - 1];
      const currentDrive = sortedDrives[i];

      // Calculate gap between drives
      const gapMinutes = (currentDrive.started_at - prevDrive.ended_at) / 60;

      // Check if this should be merged with the previous group
      if (this.shouldMergeDrives(prevDrive, currentDrive, gapMinutes)) {
        currentGroup.push(currentDrive);
      } else {
        // Process the current group and start a new one
        mergedDrives.push(this.createMergedDrive(currentGroup));
        currentGroup = [currentDrive];
      }
    }

    // Process the final group
    if (currentGroup.length > 0) {
      mergedDrives.push(this.createMergedDrive(currentGroup));
    }

    return mergedDrives;
  }

  private shouldMergeDrives(prevDrive: TessieDrive, currentDrive: TessieDrive, gapMinutes: number): boolean {
    // Merge if gap is less than 7 minutes
    if (gapMinutes < 7) {
      return true;
    }

    // TODO: Add charging detection logic
    // This would require checking if the gap includes charging based on battery level changes
    // For now, we'll use a simple heuristic: if battery level increased significantly during the gap
    const batteryIncrease = currentDrive.starting_battery - prevDrive.ending_battery;
    if (batteryIncrease > 5) { // More than 5% battery increase suggests charging
      return true;
    }

    return false;
  }

  private createMergedDrive(drives: TessieDrive[]): MergedDrive {
    if (drives.length === 0) {
      throw new Error('Cannot create merged drive from empty array');
    }

    const firstDrive = drives[0];
    const lastDrive = drives[drives.length - 1];

    // Calculate stops between drives
    const stops: DriveStop[] = [];
    for (let i = 0; i < drives.length - 1; i++) {
      const current = drives[i];
      const next = drives[i + 1];
      const gapMinutes = (next.started_at - current.ended_at) / 60;

      if (gapMinutes > 0) {
        const batteryChange = next.starting_battery - current.ending_battery;
        const stopType = batteryChange > 5 ? 'charging' : gapMinutes < 7 ? 'short' : 'excluded';

        stops.push({
          location: current.ending_location,
          duration_minutes: Math.round(gapMinutes * 100) / 100,
          stop_type: stopType,
          started_at: current.ended_at,
          ended_at: next.started_at
        });
      }
    }

    // Calculate totals
    const totalDistance = drives.reduce((sum, drive) => sum + drive.odometer_distance, 0);
    const totalDuration = (lastDrive.ended_at - firstDrive.started_at) / 60; // in minutes
    const drivingDuration = drives.reduce((sum, drive) => {
      return sum + ((drive.ended_at - drive.started_at) / 60);
    }, 0);

    // Calculate speeds
    const maxSpeed = Math.max(...drives.map(d => d.max_speed || 0));
    const averageSpeed = totalDistance > 0 ? (totalDistance / (drivingDuration / 60)) : 0;

    // Create initial merged drive without autopilot data (will be predicted later)
    const mergedDrive = {
      id: `merged_${drives.map(d => d.id).join('_')}`,
      originalDriveIds: drives.map(d => d.id),
      started_at: firstDrive.started_at,
      ended_at: lastDrive.ended_at,
      starting_location: firstDrive.starting_location,
      ending_location: lastDrive.ending_location,
      starting_battery: firstDrive.starting_battery,
      ending_battery: lastDrive.ending_battery,
      total_distance: Math.round(totalDistance * 100) / 100,
      total_duration_minutes: Math.round(totalDuration * 100) / 100,
      driving_duration_minutes: Math.round(drivingDuration * 100) / 100,
      stops,
      autopilot_distance: 0, // Will be predicted in analyzeFSDUsage
      autopilot_percentage: 0, // Will be predicted in analyzeFSDUsage
      energy_consumed: firstDrive.starting_battery - lastDrive.ending_battery,
      average_speed: Math.round(averageSpeed * 100) / 100,
      max_speed: Math.round(maxSpeed * 100) / 100
    };

    // Predict autopilot usage for this merged drive
    const predictedAutopilotMiles = this.predictAutopilotUsage(mergedDrive);
    mergedDrive.autopilot_distance = predictedAutopilotMiles;
    mergedDrive.autopilot_percentage = totalDistance > 0
      ? Math.round((predictedAutopilotMiles / totalDistance) * 10000) / 100
      : 0;

    return mergedDrive;
  }

  /**
   * Analyzes the most recent merged drive with comprehensive metrics
   */
  analyzeLatestDrive(drives: TessieDrive[]): DriveAnalysis | null {
    if (drives.length === 0) return null;

    const mergedDrives = this.mergeDrives(drives);
    if (mergedDrives.length === 0) return null;

    // Get the most recent merged drive
    const latestMerged = mergedDrives[mergedDrives.length - 1];

    // Calculate battery consumption analysis
    const batteryConsumption = this.analyzeBatteryConsumption(latestMerged);

    // Calculate FSD analysis
    const fsdAnalysis = this.analyzeFSDUsage(latestMerged);

    // Generate summary
    const summary = this.generateDriveSummary(latestMerged, batteryConsumption, fsdAnalysis);

    return {
      mergedDrive: latestMerged,
      batteryConsumption,
      fsdAnalysis,
      summary
    };
  }

  private analyzeBatteryConsumption(drive: MergedDrive) {
    const percentageUsed = Math.round((drive.energy_consumed) * 100) / 100;

    // Estimate kWh usage (rough Tesla Model 3/Y approximation: ~75-100kWh total capacity)
    // This is an approximation - actual capacity varies by model and year
    const estimatedTotalCapacity = 75; // kWh - conservative estimate
    const estimatedKwhUsed = Math.round((percentageUsed / 100) * estimatedTotalCapacity * 100) / 100;

    const efficiency = drive.total_distance > 0 && estimatedKwhUsed > 0
      ? Math.round((drive.total_distance / estimatedKwhUsed) * 100) / 100
      : undefined;

    return {
      percentage_used: percentageUsed,
      estimated_kwh_used: estimatedKwhUsed,
      efficiency_miles_per_kwh: efficiency
    };
  }

  private analyzeFSDUsage(drive: MergedDrive) {
    // Predict FSD usage based on driving patterns since Tessie API doesn't provide autopilot data
    const predictedAutopilotMiles = this.predictAutopilotUsage(drive);
    const predictedPercentage = drive.total_distance > 0
      ? Math.round((predictedAutopilotMiles / drive.total_distance) * 10000) / 100
      : 0;

    return {
      total_autopilot_miles: predictedAutopilotMiles,
      fsd_percentage: predictedPercentage,
      autopilot_available: true,
      note: predictedAutopilotMiles > 0
        ? "Estimated based on highway driving patterns and speed consistency"
        : "Low probability of FSD usage detected from driving patterns"
    };
  }

  /**
   * Predicts autopilot usage based on driving patterns
   * Factors: highway speeds, long distance, speed consistency, duration
   */
  predictAutopilotUsage(drive: MergedDrive): number {
    if (drive.total_distance < 5) {
      // Very short drives unlikely to use autopilot
      return 0;
    }

    let autopilotLikelihood = 0;

    // Factor 1: Highway speed indicator (speeds > 45 mph suggest highway driving)
    if (drive.average_speed > 45) {
      autopilotLikelihood += 0.4; // Strong indicator
    } else if (drive.average_speed > 35) {
      autopilotLikelihood += 0.2; // Moderate indicator
    }

    // Factor 2: Distance-based likelihood (longer drives more likely to use autopilot)
    if (drive.total_distance > 30) {
      autopilotLikelihood += 0.3; // Long highway drives
    } else if (drive.total_distance > 15) {
      autopilotLikelihood += 0.2; // Medium distance drives
    } else if (drive.total_distance > 10) {
      autopilotLikelihood += 0.1; // Short highway segments
    }

    // Factor 3: Speed consistency (autopilot tends to maintain steady speeds)
    const speedConsistency = this.calculateSpeedConsistency(drive);
    autopilotLikelihood += speedConsistency * 0.2;

    // Factor 4: Duration factor (longer drives on highways more likely to use autopilot)
    const avgDrivingSpeed = drive.total_distance / (drive.driving_duration_minutes / 60);
    if (avgDrivingSpeed > 50 && drive.driving_duration_minutes > 30) {
      autopilotLikelihood += 0.1; // Extended highway driving
    }

    // Cap likelihood at 1.0 and apply to distance
    autopilotLikelihood = Math.min(autopilotLikelihood, 0.9); // Max 90% of drive

    // Calculate estimated autopilot miles
    const estimatedAutopilotMiles = drive.total_distance * autopilotLikelihood;

    return Math.round(estimatedAutopilotMiles * 100) / 100;
  }

  /**
   * Calculate speed consistency score (0-1, where 1 is perfectly consistent)
   */
  calculateSpeedConsistency(drive: MergedDrive): number {
    // Simple heuristic: if max speed isn't much higher than average,
    // it suggests consistent speeds (typical of autopilot)
    if (drive.average_speed === 0 || drive.max_speed === 0) return 0;

    const speedRatio = drive.average_speed / drive.max_speed;

    // If average is close to max speed, it's very consistent
    if (speedRatio > 0.85) return 1.0;
    if (speedRatio > 0.75) return 0.8;
    if (speedRatio > 0.65) return 0.6;
    if (speedRatio > 0.55) return 0.4;
    return 0.2;
  }

  private generateDriveSummary(
    drive: MergedDrive,
    battery: { percentage_used: number; estimated_kwh_used: number; efficiency_miles_per_kwh?: number },
    fsd: { total_autopilot_miles: number; fsd_percentage: number; autopilot_available: boolean; note?: string }
  ): string {
    const duration = drive.total_duration_minutes;
    const drivingTime = drive.driving_duration_minutes;
    const stopTime = duration - drivingTime;

    let summary = `Drive from ${drive.starting_location} to ${drive.ending_location}:\n`;
    summary += `• Total time: ${Math.floor(duration / 60)}h ${Math.round(duration % 60)}m\n`;
    summary += `• Driving time: ${Math.floor(drivingTime / 60)}h ${Math.round(drivingTime % 60)}m\n`;

    if (stopTime > 1) {
      summary += `• Stop time: ${Math.floor(stopTime / 60)}h ${Math.round(stopTime % 60)}m`;
      if (drive.stops.length > 0) {
        const chargingStops = drive.stops.filter(s => s.stop_type === 'charging').length;
        const shortStops = drive.stops.filter(s => s.stop_type === 'short').length;
        if (chargingStops > 0) summary += ` (${chargingStops} charging stop${chargingStops > 1 ? 's' : ''})`;
        if (shortStops > 0) summary += ` (${shortStops} short stop${shortStops > 1 ? 's' : ''})`;
      }
      summary += `\n`;
    }

    summary += `• Distance: ${drive.total_distance} miles\n`;
    summary += `• Average speed: ${drive.average_speed} mph (max: ${drive.max_speed} mph)\n`;
    summary += `• Battery used: ${battery.percentage_used}% (≈${battery.estimated_kwh_used} kWh)\n`;

    if (battery.efficiency_miles_per_kwh) {
      summary += `• Efficiency: ${battery.efficiency_miles_per_kwh} mi/kWh\n`;
    }

    if (fsd.autopilot_available && fsd.total_autopilot_miles > 0) {
      summary += `• FSD/Autopilot: ${fsd.total_autopilot_miles} miles (${fsd.fsd_percentage}% of drive)`;
    } else {
      summary += `• FSD/Autopilot: ${fsd.note || 'Data not available'}`;
    }

    return summary;
  }
}