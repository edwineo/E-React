export type WorkTag = // 整体的 tag
	| typeof FunctionComponent
	| typeof HostRoot
	| typeof HostComponent
	| typeof HostText
	| typeof Fragment
	| typeof ContextProvider
	| typeof SuspenseComponent
	| typeof OffscreenComponent
	| typeof LazyComponent
	| typeof MemoComponent;

export const FunctionComponent = 0;
export const HostRoot = 3;

export const HostComponent = 5; // <div> 标签对应的就是 HostComponent
export const HostText = 6; // div 下面的文本，例如 <div>123</div>
export const Fragment = 7;
export const ContextProvider = 8;

export const SuspenseComponent = 13;
export const OffscreenComponent = 14;

export const LazyComponent = 16;
export const MemoComponent = 15;
