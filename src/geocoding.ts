/**
 * Simple reverse geocoding utility using OpenStreetMap Nominatim API
 * No API key required, respects rate limits
 */
export class GeocodingService {
  private static readonly NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/reverse';
  private static readonly USER_AGENT = 'TessieMCP/1.1.1';
  private static readonly RATE_LIMIT_MS = 1000; // 1 request per second

  private static lastRequestTime = 0;
  private static cache = new Map<string, string>();

  /**
   * Convert latitude/longitude to human-readable address
   */
  static async reverseGeocode(latitude: number, longitude: number): Promise<string> {
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
      return 'Location unavailable';
    }

    // Check cache first
    const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // Respect rate limiting
      await this.enforceRateLimit();

      const url = new URL(this.NOMINATIM_BASE_URL);
      url.searchParams.set('lat', latitude.toString());
      url.searchParams.set('lon', longitude.toString());
      url.searchParams.set('format', 'json');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('zoom', '18'); // High detail level

      const response = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      let address = this.formatAddress(data);

      // Cache the result
      this.cache.set(cacheKey, address);

      // Limit cache size to prevent memory leaks
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      return address;

    } catch (error) {
      console.warn(`Geocoding failed for ${latitude}, ${longitude}:`, error);
      return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
    }
  }

  /**
   * Format the Nominatim response into a readable address
   */
  private static formatAddress(data: any): string {
    if (!data || !data.address) {
      return data?.display_name?.split(',').slice(0, 3).join(', ') || 'Unknown location';
    }

    const addr = data.address;
    const parts: string[] = [];

    // Build address from specific to general
    if (addr.house_number && addr.road) {
      parts.push(`${addr.house_number} ${addr.road}`);
    } else if (addr.road) {
      parts.push(addr.road);
    } else if (addr.amenity) {
      parts.push(addr.amenity);
    }

    if (addr.city || addr.town || addr.village) {
      parts.push(addr.city || addr.town || addr.village);
    } else if (addr.county) {
      parts.push(addr.county);
    }

    if (addr.state || addr.province) {
      parts.push(addr.state || addr.province);
    }

    if (addr.country_code) {
      parts.push(addr.country_code.toUpperCase());
    }

    // If we couldn't build a good address, use display_name
    if (parts.length === 0) {
      return data.display_name?.split(',').slice(0, 4).join(', ') || 'Unknown location';
    }

    return parts.join(', ');
  }

  /**
   * Enforce rate limiting to be respectful to the Nominatim service
   */
  private static async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Get approximate distance between two lat/lng points in miles
   */
  static getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private static toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}