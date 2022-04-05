import { CaseReducer, configureStore, createSlice, Draft, ConfigureStoreOptions } from "@reduxjs/toolkit"
import { TypedUseSelectorHook, useSelector } from "react-redux"
import { hookFunc } from "../utils/common"

type Reducer<S> = (state: Draft<S>, ...args: any[]) => S | void
type RestParameters<S, T extends (...args: any) => any> = T extends (state: S, ...args: infer P) => any ? P : never;
type UnwarpReducer<S, F extends Reducer<S>> = (...a: RestParameters<S, F>) => void

export type ReducerMap<S> = { [key: string]: Reducer<S> | ReducerMap<S> }
type UnwarpReducerMap<S, T extends ReducerMap<S>> = {
    [K in keyof T]:
        T[K] extends Reducer<S> ? UnwarpReducer<S, T[K]> :
        T[K] extends ReducerMap<S> ? UnwarpReducerMap<S, T[K]> :
        unknown
}

function flattenReducers<S>(reducers: ReducerMap<S>,
        prefix = '', out = { } as Record<string, CaseReducer<S, { payload: any; type: string; }>>) {
    for (const [sub, val] of Object.entries(reducers)) {
        const key = prefix ? prefix + '/' + sub : sub
        if (typeof val === 'function') {
            out[key] = (state, action) => val(state, ...action.payload)
        } else {
            flattenReducers(val, key, out)
        }
    }
    return out
}

function makeSlice<S, R extends ReducerMap<S>>(name: string,
        init: S, reducers: R, disp: (action: any) => any) {
    const slice = createSlice({
            name,
            initialState: init,
            reducers: flattenReducers(reducers)
        }),
        dispatch = hookFunc({ }, (...stack) => {
            const key = stack.reverse().map(item => item.propKey).join('/'),
                action = slice.actions[key]
            return (...args: any[]) => {
                if (!action) {
                    throw Error(`the reducer ${key} is not found`)
                }
                disp(action(args))
            }
        }) as UnwarpReducerMap<S, R>
    return { dispatch, slice }
}

interface SliceDefine<S, R extends ReducerMap<S>> {
    state: S
    reducers: R
}
type DispatchFromSlice<T extends { [key: string]: SliceDefine<any, any> }> = {
    [K in keyof T]: T[K] extends SliceDefine<infer S, infer R> ? UnwarpReducerMap<S, R> : unknown
}
type RootFromSlice<T extends { [key: string]: SliceDefine<any, any> }> = {
    [K in keyof T]: T[K] extends SliceDefine<infer S, any> ? S : unknown
}
export function slice<S, R extends ReducerMap<S>>(state: S, reducers: R) {
    return { state, reducers }
}
export function configure<T extends { [key: string]: SliceDefine<any, any> }>(sliceDefine: T, opts = { } as Partial<ConfigureStoreOptions>) {
    const disp = (action: any) => { (store.dispatch as any)(action) },
        slices = Object.entries(sliceDefine)
            .map(([name, { state, reducers }]) => makeSlice(name, state, reducers, disp)),
        dispatch = Object
            .fromEntries(slices.map(({ slice, dispatch }) => [slice.name, dispatch])) as DispatchFromSlice<T>,
        select = useSelector as TypedUseSelectorHook<RootFromSlice<T>>,
        store = configureStore({
            reducer: Object.fromEntries(slices.map(({ slice }) => [slice.name, slice.reducer])),
            ...opts,
        })
    return { slices, dispatch, store, select }
}
