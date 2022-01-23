import React from 'react'

import lambda from '../lambda'
import resource from '../wrapper/resource'

const res = resource(lambda)
export default function App() {
    const message = res.hello('Kokomi')
    return <span>hello { message.toString() }</span>
}
