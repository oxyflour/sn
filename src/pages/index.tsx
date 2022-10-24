import React, { useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import lambda from '../lambda'
import resource from '../wrapper/resource'
import { slice, configure } from '../wrapper/redux'
import { RouteMatch } from 'react-router-dom'

const counter = slice({ value: 0 }, {
    inc(state) {
        state.value += 1
    },
    test: {
        add(state, num: number) {
            state.value += num
        }
    }
})

const { dispatch, select, store } = configure({ counter })
export function Counter() {
    const count = select(state => state.counter.value)
    return <div>
        { count }
        <button onClick={ () => dispatch.counter.inc() }>inc</button>
        <span> </span>
        <button onClick={ () => dispatch.counter.test.add(10) }>add 10</button>
    </div>
}

const res = resource(lambda as Omit<typeof lambda, 'stream'>),
    enc = new TextDecoder()
export function Message() {
    const buf = res.hello('KokomiMain')
    return <div>
        Message { enc.decode(buf) }
    </div>
}

export function Tick() {
    const [tick, setTick] = useState(0)
    async function start() {
        for await (const tick of lambda.stream()) {
            setTick(tick)
        }
    }
    useEffect(() => { start() }, [])
    return <div>
        tick: { tick }
    </div>
}

export const loading = () => <div>my loading...</div>
export const layout = (props: any) => <div className="layout">{ props.children }</div>

export default function Root({ params }: RouteMatch<'id'>) {
    console.log('route params', params)
    return <Provider store={ store }>
        <Counter />
        <Message />
        <Tick />
    </Provider>
}
