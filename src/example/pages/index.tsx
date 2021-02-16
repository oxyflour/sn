import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'

import api from '../lambda'
import wrapper from '../../wrapper/web'
const lambda = wrapper<typeof api>({ url: '/rpc' })

function App() {
    const [message, setMessage] = useState('...')
    async function init() {
        setMessage(await lambda.hello())
    }
    useEffect(() => { init() }, [])
    return <div>
        hello { message }
    </div>
}

let root = document.getElementById('root')
if (!root) {
    root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
}
ReactDOM.render(<App />, root)

const mod = module as any
if (mod.hot) {
    mod.hot.accept()
}
