import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { ErrorHandler, EnhancedError } from './error-handler.js';

export interface TessieVehicleState {
  display_name?: string;
  vin: string;
  state?: string;
  timestamp?: number;
  
  // Nested structure (Tesla API format)
  vehicle_state?: {
    vehicle_name?: string;
    locked?: boolean;
    sentry_mode?: boolean;
    odometer?: number;
  };
  charge_state?: {
    battery_level?: number;
    est_battery_range?: number;
    charging_state?: string;
    time_to_full_charge?: number;
  };
  climate_state?: {
    inside_temp?: number;
    outside_temp?: number;
    is_climate_on?: boolean;
  };
  drive_state?: {
    latitude?: number;
    longitude?: number;
    shift_state?: string;
    speed?: number;
    power?: number;
  };
  
  // Flat properties (Tessie API actual response format)
  // These are added to match the actual API behavior
  battery_level?: number;
  battery_range?: number;
  charging_state?: string;
  time_to_full_charge?: number;
  latitude?: number;
  longitude?: number;
  locked?: boolean;
  sentry_mode?: boolean;
  odometer?: number;
  inside_temp?: number;
  outside_temp?: number;
  is_climate_on?: boolean;
}

export interface TessieDrive {
  id: number;
  import_id?: string;
  started_at: number;
  ended_at: number;
  created_at: number;
  updated_at?: number;
  starting_location: string;
  starting_latitude: number;
  starting_longitude: number;
  starting_odometer: number;
  starting_saved_location?: string;
  ending_location: string;
  ending_latitude: number;
  ending_longitude: number;
  ending_odometer: number;
  ending_saved_location?: string;
  starting_battery: number;
  ending_battery: number;
  average_inside_temperature?: number;
  average_outside_temperature?: number;
  average_speed?: number;
  max_speed?: number;
  rated_range_used?: number;
  ideal_range_used?: number;
  odometer_distance: number;
  energy_used?: number;
  tag?: string;

  // Legacy field mappings for backward compatibility
  start_date?: string;
  end_date?: string;
  start_address?: string;
  end_address?: string;
  start_saved_location?: string;
  end_saved_location?: string;
  distance_miles?: number;
  duration_min?: number;
  start_odometer?: number;
  end_odometer?: number;
  start_battery_level?: number;
  end_battery_level?: number;
}

export interface TessieLocation {
  vin: string;
  latitude: number;
  longitude: number;
  address: string;
  saved_location?: string;
}

export interface TessieTirePressure {
  front_left: number;
  front_right: number;
  rear_left: number;
  rear_right: number;
  front_left_status: 'unknown' | 'low' | 'normal';
  front_right_status: 'unknown' | 'low' | 'normal';
  rear_left_status: 'unknown' | 'low' | 'normal';
  rear_right_status: 'unknown' | 'low' | 'normal';
  timestamp: number;
}

export class TessieClient {
  private client: AxiosInstance;
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: 'https://api.tessie.com',
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async getVehicleState(vin: string, useCache: boolean = true): Promise<TessieVehicleState> {
    return ErrorHandler.withRetry(async () => {
      const response: AxiosResponse<TessieVehicleState> = await this.client.get(
        `/${vin}/state${useCache ? '?use_cache=true' : ''}`
      );
      return response.data;
    }, {
      maxRetries: useCache ? 2 : 3, // Fewer retries when using cache
      baseDelay: 1500
    });
  }

  async getVehicleStates(
    vin: string,
    startDate?: string,
    endDate?: string
  ): Promise<TessieVehicleState[]> {
    return ErrorHandler.withRetry(async () => {
      const params = new URLSearchParams();
      if (startDate) params.append('start', startDate);
      if (endDate) params.append('end', endDate);

      const response: AxiosResponse<TessieVehicleState[]> = await this.client.get(
        `/${vin}/states?${params.toString()}`
      );
      return response.data;
    }, {
      maxRetries: 2, // Historical data is less time-sensitive
      baseDelay: 2000
    });
  }

  async getVehicleLocation(vin: string): Promise<TessieLocation> {
    return ErrorHandler.withRetry(async () => {
      const response: AxiosResponse<TessieLocation> = await this.client.get(`/${vin}/location`);
      return response.data;
    }, {
      maxRetries: 3,
      baseDelay: 1000
    });
  }

  async getDrives(
    vin: string,
    startDate?: string,
    endDate?: string,
    limit: number = 50
  ): Promise<TessieDrive[]> {
    return ErrorHandler.withRetry(async () => {
      const params = new URLSearchParams();
      if (startDate) params.append('start', startDate);
      if (endDate) params.append('end', endDate);
      params.append('limit', limit.toString());

      const response: AxiosResponse<{ results: TessieDrive[] } | TessieDrive[]> = await this.client.get(
        `/${vin}/drives?${params.toString()}`
      );

      // Handle both old and new API response formats
      if (response.data && typeof response.data === 'object' && 'results' in response.data) {
        return response.data.results;
      }

      return response.data as TessieDrive[];
    }, {
      maxRetries: 2, // Historical data requests
      baseDelay: 2500
    });
  }

  async getDrivingPath(
    vin: string,
    startDate: string,
    endDate: string
  ): Promise<Array<{ latitude: number; longitude: number; timestamp: string }>> {
    return ErrorHandler.withRetry(async () => {
      const params = new URLSearchParams();
      params.append('start', startDate);
      params.append('end', endDate);

      const response: AxiosResponse<Array<{ latitude: number; longitude: number; timestamp: string }>> =
        await this.client.get(`/${vin}/path?${params.toString()}`);
      return response.data;
    }, {
      maxRetries: 1, // Path data is large and less critical
      baseDelay: 3000
    });
  }

  async getVehicles(): Promise<Array<{ vin: string; display_name: string }>> {
    return ErrorHandler.withRetry(async () => {
      const response: AxiosResponse<{ results: any[] } | any[]> =
        await this.client.get('/vehicles');

      // Handle both old and new API response formats
      let vehicles: any[];
      if (response.data && typeof response.data === 'object' && 'results' in response.data) {
        vehicles = response.data.results;
      } else {
        vehicles = response.data as any[];
      }

      // Extract VIN and display name from the new format
      return vehicles.map(vehicle => ({
        vin: vehicle.vin,
        display_name: vehicle.last_state?.vehicle_state?.vehicle_name || vehicle.display_name || `Vehicle ${vehicle.vin.slice(-6)}`
      }));
    }, {
      maxRetries: 2, // Account list is fairly stable
      baseDelay: 1500
    });
  }

  async getTirePressure(
    vin: string,
    pressureFormat: 'bar' | 'kpa' | 'psi' = 'psi',
    from?: number,
    to?: number
  ): Promise<TessieTirePressure> {
    return ErrorHandler.withRetry(async () => {
      const params = new URLSearchParams();
      params.append('pressure_format', pressureFormat);
      if (from) params.append('from', from.toString());
      if (to) params.append('to', to.toString());

      const response: AxiosResponse<TessieTirePressure> = await this.client.get(
        `/${vin}/tire_pressure?${params.toString()}`
      );
      return response.data;
    }, {
      maxRetries: 2,
      baseDelay: 1500
    });
  }
}