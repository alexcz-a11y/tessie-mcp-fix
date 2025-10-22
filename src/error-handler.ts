import { AxiosError } from 'axios';

export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  VEHICLE_ASLEEP_ERROR = 'VEHICLE_ASLEEP_ERROR',
  VEHICLE_OFFLINE_ERROR = 'VEHICLE_OFFLINE_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface EnhancedError {
  type: ErrorType;
  message: string;
  originalError?: any;
  retryable: boolean;
  statusCode?: number;
  suggestion?: string;
  userFriendly: string;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  retryableErrors: ErrorType[];
}

export class ErrorHandler {
  private static readonly DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    exponentialBase: 2,
    retryableErrors: [
      ErrorType.NETWORK_ERROR,
      ErrorType.TIMEOUT_ERROR,
      ErrorType.RATE_LIMIT_ERROR,
      ErrorType.VEHICLE_ASLEEP_ERROR
    ]
  };

  /**
   * Classify and enhance error information
   */
  static classifyError(error: any): EnhancedError {
    if (error instanceof AxiosError) {
      return this.classifyAxiosError(error);
    }

    if (error instanceof Error) {
      return {
        type: ErrorType.UNKNOWN_ERROR,
        message: error.message,
        originalError: error,
        retryable: false,
        userFriendly: 'An unexpected error occurred. Please try again.',
        suggestion: 'If the problem persists, check your internet connection and API credentials.'
      };
    }

    return {
      type: ErrorType.UNKNOWN_ERROR,
      message: String(error),
      originalError: error,
      retryable: false,
      userFriendly: 'An unknown error occurred.',
      suggestion: 'Please try again or contact support if the issue persists.'
    };
  }

  private static classifyAxiosError(error: AxiosError): EnhancedError {
    const statusCode = error.response?.status;
    const responseData = error.response?.data as any;

    // Check for specific Tessie API error patterns
    if (responseData?.error) {
      const errorMessage = responseData.error;

      // Vehicle state specific errors
      if (errorMessage.includes('asleep') || errorMessage.includes('sleeping')) {
        return {
          type: ErrorType.VEHICLE_ASLEEP_ERROR,
          message: `Vehicle is asleep: ${errorMessage}`,
          originalError: error,
          retryable: true,
          statusCode,
          userFriendly: 'Your Tesla is currently asleep.',
          suggestion: 'The vehicle will wake up automatically when needed. You can also wake it using the Tesla app.'
        };
      }

      if (errorMessage.includes('offline') || errorMessage.includes('not connected')) {
        return {
          type: ErrorType.VEHICLE_OFFLINE_ERROR,
          message: `Vehicle is offline: ${errorMessage}`,
          originalError: error,
          retryable: false,
          statusCode,
          userFriendly: 'Your Tesla is currently offline.',
          suggestion: 'Check that your vehicle has cellular connectivity. Try starting the vehicle or using the Tesla app.'
        };
      }
    }

    // HTTP status code based classification
    switch (statusCode) {
      case 401:
      case 403:
        return {
          type: ErrorType.AUTHENTICATION_ERROR,
          message: 'Authentication failed',
          originalError: error,
          retryable: false,
          statusCode,
          userFriendly: 'Authentication failed - invalid API token.',
          suggestion: 'Check your Tessie API token in the configuration. Get a valid token from tessie.com.'
        };

      case 429:
        const retryAfter = error.response?.headers['retry-after'];
        return {
          type: ErrorType.RATE_LIMIT_ERROR,
          message: `Rate limit exceeded${retryAfter ? ` - retry after ${retryAfter}s` : ''}`,
          originalError: error,
          retryable: true,
          statusCode,
          userFriendly: 'Too many requests - please wait a moment.',
          suggestion: retryAfter
            ? `Wait ${retryAfter} seconds before trying again.`
            : 'Wait a few seconds and try again. Tessie has rate limits to protect the service.'
        };

      case 404:
        return {
          type: ErrorType.API_ERROR,
          message: 'Resource not found',
          originalError: error,
          retryable: false,
          statusCode,
          userFriendly: 'Requested information not found.',
          suggestion: 'Check that the VIN is correct and the vehicle is linked to your Tessie account.'
        };

      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: ErrorType.API_ERROR,
          message: `Server error (${statusCode})`,
          originalError: error,
          retryable: true,
          statusCode,
          userFriendly: 'Tessie service is temporarily unavailable.',
          suggestion: 'This is a temporary server issue. Please try again in a few moments.'
        };

      case 408:
        return {
          type: ErrorType.TIMEOUT_ERROR,
          message: 'Request timeout',
          originalError: error,
          retryable: true,
          statusCode,
          userFriendly: 'Request timed out.',
          suggestion: 'The request took too long. This often happens when the vehicle is waking up. Try again.'
        };

      default:
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          return {
            type: ErrorType.TIMEOUT_ERROR,
            message: 'Connection timeout',
            originalError: error,
            retryable: true,
            userFriendly: 'Connection timed out.',
            suggestion: 'Check your internet connection and try again.'
          };
        }

        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
          return {
            type: ErrorType.NETWORK_ERROR,
            message: 'Network connection failed',
            originalError: error,
            retryable: true,
            userFriendly: 'Unable to connect to Tessie service.',
            suggestion: 'Check your internet connection and try again.'
          };
        }

        return {
          type: ErrorType.API_ERROR,
          message: `HTTP ${statusCode}: ${error.message}`,
          originalError: error,
          retryable: statusCode ? statusCode >= 500 : false,
          statusCode,
          userFriendly: 'An API error occurred.',
          suggestion: 'Please try again. If the problem persists, check the Tessie service status.'
        };
    }
  }

  /**
   * Execute a function with retry logic
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const config = { ...this.DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: EnhancedError;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = this.classifyError(error);

        // Don't retry on the last attempt or for non-retryable errors
        if (attempt === config.maxRetries || !config.retryableErrors.includes(lastError.type)) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(config.exponentialBase, attempt),
          config.maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitteredDelay = delay + Math.random() * 1000;

        console.warn(`Attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${Math.round(jitteredDelay)}ms...`);
        await this.sleep(jitteredDelay);
      }
    }

    throw lastError!;
  }

  /**
   * Sleep for specified milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format error for user-friendly display
   */
  static formatErrorForUser(error: EnhancedError): string {
    let message = `❌ ${error.userFriendly}`;

    if (error.suggestion) {
      message += `\n💡 ${error.suggestion}`;
    }

    if (error.type === ErrorType.RATE_LIMIT_ERROR) {
      message += '\n⏱️ Tessie API has rate limits to ensure service reliability.';
    }

    if (error.type === ErrorType.VEHICLE_ASLEEP_ERROR) {
      message += '\n😴 Teslas sleep to conserve battery when not in use.';
    }

    return message;
  }

  /**
   * Check if an error should trigger a graceful degradation
   */
  static shouldDegrade(error: EnhancedError): boolean {
    return [
      ErrorType.VEHICLE_ASLEEP_ERROR,
      ErrorType.VEHICLE_OFFLINE_ERROR,
      ErrorType.RATE_LIMIT_ERROR,
      ErrorType.TIMEOUT_ERROR
    ].includes(error.type);
  }

  /**
   * Generate fallback response for degraded scenarios
   * Returns MCP-compliant format with content array
   */
  static generateFallbackResponse(error: EnhancedError, context: string): any {
    const fallbackData = {
      status: 'degraded',
      error_type: error.type,
      message: error.userFriendly,
      suggestion: error.suggestion,
      context: `${context} unavailable due to ${error.type.toLowerCase().replace('_', ' ')}`,
      retry_recommended: error.retryable,
      fallback_data: {
        timestamp: new Date().toISOString(),
        note: 'This is a fallback response due to service unavailability'
      }
    };

    // Wrap in MCP-compliant content array format
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(fallbackData, null, 2)
        }
      ]
    };
  }
}