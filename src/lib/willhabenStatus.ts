export interface WillhabenAccessStatus {
  forbidden: boolean;
  lastForbiddenAt: string | null;
  lastSuccessAt: string | null;
  lastMessage: string | null;
}

let state: WillhabenAccessStatus = {
  forbidden: false,
  lastForbiddenAt: null,
  lastSuccessAt: null,
  lastMessage: null,
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

export function resetWillhabenAccessStatus(): void {
  state = {
    forbidden: false,
    lastForbiddenAt: null,
    lastSuccessAt: null,
    lastMessage: null,
  };
}
