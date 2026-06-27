export interface WillhabenAccessStatus {
  forbidden: boolean;
  lastForbiddenAt: string | null;
  lastSuccessAt: string | null;
  lastMessage: string | null;
}

export interface VerificationRateLimitStatus {
  deferred: boolean;
  deferredCount: number;
  lastDeferredAt: string | null;
  requestsPerMinuteLimit: number;
}

export interface UiAlerts {
  willhabenAccess: WillhabenAccessStatus;
  verificationRateLimit: VerificationRateLimitStatus;
}

let state: WillhabenAccessStatus = {
  forbidden: false,
  lastForbiddenAt: null,
  lastSuccessAt: null,
  lastMessage: null,
};

let verificationState: VerificationRateLimitStatus = {
  deferred: false,
  deferredCount: 0,
  lastDeferredAt: null,
  requestsPerMinuteLimit: 25,
};

export function getWillhabenAccessStatus(): WillhabenAccessStatus {
  return { ...state };
}

export function recordWillhabenForbidden(
  message: string,
  at: string = new Date().toISOString(),
): void {
  state = {
    forbidden: true,
    lastForbiddenAt: at,
    lastSuccessAt: state.lastSuccessAt,
    lastMessage: message,
  };
}

export function recordWillhabenSuccess(at: string = new Date().toISOString()): void {
  state = {
    forbidden: false,
    lastForbiddenAt: state.lastForbiddenAt,
    lastSuccessAt: at,
    lastMessage: null,
  };
}

export function getVerificationRateLimitStatus(): VerificationRateLimitStatus {
  return { ...verificationState };
}

export function getUiAlerts(): UiAlerts {
  return {
    willhabenAccess: getWillhabenAccessStatus(),
    verificationRateLimit: getVerificationRateLimitStatus(),
  };
}

export function recordVerificationDeferred(
  count: number,
  requestsPerMinuteLimit: number,
  at: string = new Date().toISOString(),
): void {
  verificationState = {
    deferred: count > 0,
    deferredCount: count,
    lastDeferredAt: at,
    requestsPerMinuteLimit,
  };
}

export function clearVerificationDeferred(): void {
  verificationState = {
    deferred: false,
    deferredCount: 0,
    lastDeferredAt: verificationState.lastDeferredAt,
    requestsPerMinuteLimit: verificationState.requestsPerMinuteLimit,
  };
}

export function resetWillhabenAccessStatus(): void {
  state = {
    forbidden: false,
    lastForbiddenAt: null,
    lastSuccessAt: null,
    lastMessage: null,
  };
  verificationState = {
    deferred: false,
    deferredCount: 0,
    lastDeferredAt: null,
    requestsPerMinuteLimit: 25,
  };
}
