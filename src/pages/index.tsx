import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import api from '../lambda'
import wrapper from '../wrapper/web'
const lambda = wrapper<typeof api>({ url: '/rpc' })

export default function App() {
    const [message, setMessage] = useState('...')
    async function init() {
        setMessage(await lambda.hello())
    }
    useEffect(() => { init() }, [])
    return <div>
        hell0 { message }
        <br />
        <Link to="/item/0">items 0</Link>
    </div>
}
