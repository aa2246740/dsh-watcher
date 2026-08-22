export type DisclosureDepth = 'overview' | 'detail'

export type DisclosureLayer = 'phase' | 'step' | 'cluster' | 'model' | 'reasoning'

type LayerOverrides = Readonly<Record<DisclosureLayer, Readonly<Record<string, boolean>>>>

export interface DisclosureState {
  readonly depth: DisclosureDepth
  readonly turns: Readonly<Record<number, boolean>>
  readonly layers: LayerOverrides
}

function emptyLayerOverrides(): LayerOverrides {
  return {
    phase: {},
    step: {},
    cluster: {},
    model: {},
    reasoning: {},
  }
}

export function createDisclosureState(depth: DisclosureDepth = 'overview'): DisclosureState {
  return { depth, turns: {}, layers: emptyLayerOverrides() }
}

/** Overview keeps the automatic Turn policy; detail opens every Turn by default. */
export function turnDisclosureOpen(
  state: DisclosureState,
  turn: number,
  overviewDefaultOpen: boolean,
): boolean {
  return state.turns[turn] ?? (state.depth === 'detail' || overviewDefaultOpen)
}

/** Overview stops at phase headers; detail opens every nested level by default. */
export function layerDisclosureOpen(
  state: DisclosureState,
  layer: DisclosureLayer,
  key: string,
): boolean {
  return state.layers[layer][key] ?? state.depth === 'detail'
}

export function setLayerDisclosure(
  state: DisclosureState,
  layer: DisclosureLayer,
  key: string,
  open: boolean,
): DisclosureState {
  return {
    ...state,
    layers: {
      ...state.layers,
      [layer]: {
        ...state.layers[layer],
        [key]: open,
      },
    },
  }
}

export function toggleTurnDisclosure(
  state: DisclosureState,
  turn: number,
  overviewDefaultOpen: boolean,
): DisclosureState {
  return {
    ...state,
    turns: {
      ...state.turns,
      [turn]: !turnDisclosureOpen(state, turn, overviewDefaultOpen),
    },
  }
}

export function toggleLayerDisclosure(
  state: DisclosureState,
  layer: DisclosureLayer,
  key: string,
): DisclosureState {
  return setLayerDisclosure(state, layer, key, !layerDisclosureOpen(state, layer, key))
}

/** Choosing a depth applies it immediately instead of inheriting stale manual folds. */
export function chooseDisclosureDepth(depth: DisclosureDepth): DisclosureState {
  return createDisclosureState(depth)
}

/** Session-specific ids may change, while the user's chosen depth remains useful. */
export function resetDisclosureOverrides(state: DisclosureState): DisclosureState {
  return createDisclosureState(state.depth)
}
