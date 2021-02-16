import React from 'react'
import { RouteComponentProps } from 'react-router-dom'

export default function Item({ match: { params } }: RouteComponentProps<{ id: string }>) {
    return <div>item: { params.id }</div>
}
