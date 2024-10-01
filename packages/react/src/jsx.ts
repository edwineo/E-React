// ReactElement
import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols'
import { ReactElementType, Type, Key, Props, Ref } from 'shared/ReactTypes'

// ReactElement 构造函数
const ReactElement = (
	type: Type,
	key: Key,
	ref: Ref,
	props: Props
): ReactElementType => {
	const element = {
		$$typeof: REACT_ELEMENT_TYPE, // 指明当前数据结构是 react
		key,
		ref,
		props,
		type,
		_mark: 'Edwin' // 区别于真实 react 项目中的 element
	}
	return element
}

export const jsx = (type: Type, config: any, ...maybeChildren: any) => {
	let key: Key = null // key 默认为 null
	const props: Props = {}
	let ref: Ref = null

	// eslint-disable-next-line guard-for-in
	for (const prop in config) {
		const val = config[props]
		if (prop === 'key') {
			if (val !== undefined) {
				key = `${val}` // key 转成字符串
			}
			continue
		}
		if (prop === 'ref') {
			if (val !== undefined) {
				ref = val
			}
			continue
		}
		// prop 如果是自己 config 上的，而不是原型上的，则赋值
		if ({}.hasOwnProperty.call(config, prop)) {
			props[prop] = val
		}
	}

	const maybeChildrenLength = maybeChildren.length
	if (maybeChildrenLength) {
		// 如果有长度，则讨论 children 的情况
		if (maybeChildrenLength === 1) {
			props.children = maybeChildren[0] // child 是一个 reactelement
		} else {
			props.children = maybeChildren // child 是 reactelement 数组
		}
	}

	return ReactElement(type, key, ref, props) // 经过处理之后，最终返回一个新的 reactElement
}

// 实际 react 中，jsx 在开发环境会多做一些额外的检查，但这里省略掉了
export const jsxDev = jsx
