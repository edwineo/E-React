// 为了防止别人滥用 ReactElement，所以需要定义成独一无二的值
const supportSymbol = typeof Symbol === 'function' && Symbol.for // 判断当前宿主环境是否支持 Symbol

export const REACT_ELEMENT_TYPE = supportSymbol
	? Symbol.for('react.element')
	: 0xeac7
