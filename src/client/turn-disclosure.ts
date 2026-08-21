export type TurnDisclosureMode = 'automatic' | 'macro'

export interface TurnDisclosureState {
  readonly mode: TurnDisclosureMode
  readonly overrides: Readonly<Record<number, boolean>>
}

export function createTurnDisclosureState(): TurnDisclosureState {
  return { mode: 'automatic', overrides: {} }
}

/** Resolve one Turn without letting changing live defaults overwrite a user choice. */
export function turnDisclosureOpen(
  state: TurnDisclosureState,
  turn: number,
  automaticDefaultOpen: boolean,
): boolean {
  return state.overrides[turn] ?? (state.mode === 'automatic' && automaticDefaultOpen)
}

export function toggleTurnDisclosure(
  state: TurnDisclosureState,
  turn: number,
  automaticDefaultOpen: boolean,
): TurnDisclosureState {
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [turn]: !turnDisclosureOpen(state, turn, automaticDefaultOpen),
    },
  }
}

/** Switching modes starts from a clean view; per-Turn choices made afterwards remain authoritative. */
export function chooseTurnDisclosureMode(mode: TurnDisclosureMode): TurnDisclosureState {
  return { mode, overrides: {} }
}

/** Session-specific Turn numbers may change, while the user's observation mode should not. */
export function resetTurnDisclosureOverrides(state: TurnDisclosureState): TurnDisclosureState {
  return { ...state, overrides: {} }
}
