import React from 'react'
import { Provider } from 'react-redux'
import lambda from '../lambda'
import resource from '../wrapper/resource'
import { slice, configure } from '../wrapper/redux'

const counter = slice({ value: 0 }, {
    inc(state) {
        state.value += 1
    }
})

const { dispatch, select, store } = configure({ counter })
export function Counter() {
    const count = select(state => state.counter.value)
    return <div>
        { count } <button onClick={ () => dispatch.counter.inc() }>add</button>
    </div>
}

const res = resource(lambda),
    enc = new TextDecoder()
export function Message() {
    const buf = res.hello('KokomiMain')
    return <div>
        Message { enc.decode(buf) }
    </div>
}

export default function Root() {
    return <Provider store={ store }>
        <Counter />
        <Message />
    </Provider>
}
