import { Props, Key, Ref, ReactElementType, Wakeable } from 'shared/ReactTypes';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	WorkTag,
	SuspenseComponent,
	OffscreenComponent,
	LazyComponent,
	MemoComponent
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import {
	REACT_MEMO_TYPE,
	REACT_PROVIDER_TYPE,
	REACT_LAZY_TYPE,
	REACT_SUSPENSE_TYPE
} from 'shared/ReactSymbols';
import { ContextItem } from './fiberContext';

interface FiberDependencies<Value> {
	firstContext: ContextItem<Value> | null;
	lanes: Lanes;
}

export class FiberNode {
	type: any;
	tag: WorkTag;
	pendingProps: Props;
	key: Key;
	stateNode: any;
	ref: Ref | null;

	return: FiberNode | null;
	sibling: FiberNode | null;
	child: FiberNode | null;
	index: number;

	memoizedProps: Props | null;
	memoizedState: any;
	alternate: FiberNode | null;
	flags: Flags;
	subtreeFlags: Flags;
	updateQueue: unknown;
	deletions: FiberNode[] | null;

	lanes: Lanes;
	childLanes: Lanes;

	dependencies: FiberDependencies<any> | null;

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		// 实例
		this.tag = tag;
		this.key = key || null;
		// HostComponent <div> div DOM
		this.stateNode = null; // 保存的是 div 这个 DOM
		// FunctionComponent () => {}
		this.type = null; // FiberNode 的类型

		// 构成树状结构
		this.return = null; // 当子节点工作单元完成后，就应该到了父节点工作单元来完成，这个 return 的内容就是指向父 FiberNode
		this.sibling = null; // 指向兄弟 FiberNode
		this.child = null; // 指向子 FiberNode
		this.index = 0; // 子节点顺序

		this.ref = null;

		// 作为工作单元
		this.pendingProps = pendingProps;
		this.memoizedProps = null;
		this.memoizedState = null;
		this.updateQueue = null;

		this.alternate = null; // 该字段用于在两颗 FiberNode 树之间切换时来指向，current 树的 alternate 指向 workInProgress 树，workInProgress 树的 alternate 指向 current 树
		// 副作用
		this.flags = NoFlags; // 副作用的标识
		this.subtreeFlags = NoFlags;
		this.deletions = null;

		this.lanes = NoLanes;
		this.childLanes = NoLanes;

		this.dependencies = null;
	}
}

export interface PendingPassiveEffects {
	unmount: Effect[];
	update: Effect[];
}

// 状态更新机制中的 根节点
export class FiberRootNode {
	container: Container; // rootElement 节点，对于 DOM 环境来说，这里就是 DOM Element，对于其他宿主环境来说，这里就对应是其他节点
	current: FiberNode;
	finishedWork: FiberNode | null;
	pendingLanes: Lanes;
	suspendedLanes: Lanes;
	pingedLanes: Lanes;
	finishedLane: Lane;
	pendingPassiveEffects: PendingPassiveEffects;

	callbackNode: CallbackNode | null;
	callbackPriority: Lane;

	pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;

	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
		this.pendingLanes = NoLanes;
		this.suspendedLanes = NoLanes;
		this.pingedLanes = NoLanes;
		this.finishedLane = NoLane;

		this.callbackNode = null;
		this.callbackPriority = NoLane;

		this.pendingPassiveEffects = {
			unmount: [],
			update: []
		};

		this.pingCache = null;
	}
}

// 将 fiberRootNode 处理成 WorkInProgress
export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	// 每次传进来一个 fiberRootNode，经过一顿操作之后返回这个 fiberRootNode 的 alternate
	// 就相当于双缓冲机制中，我每次都获取到跟我相对应的那个 FiberNode
	let wip = current.alternate;
	// 什么情况下等于 null？首屏渲染时（mount）
	// 当是下次更新时（update），这里的 workInProgress 就有值了
	if (wip === null) {
		// mount
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;

		// 相互指向
		wip.alternate = current;
		current.alternate = wip;
	} else {
		// update
		wip.pendingProps = pendingProps;
		// 去除副作用
		wip.flags = NoFlags;
		wip.subtreeFlags = NoFlags;
		wip.deletions = null;
	}
	wip.type = current.type;
	// 这里 updateQueue 中的数据结构是 shared.pending，这样在 workInProgress 与 current 树中就可以共用同一个 updateQueue 了
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	// memoizedProps 是更新完之后的新的 state
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	wip.ref = current.ref;

	wip.lanes = current.lanes;
	wip.childLanes = current.childLanes;

	const currentDeps = current.dependencies;
	wip.dependencies =
		currentDeps === null
			? null
			: {
					lanes: currentDeps.lanes,
					firstContext: currentDeps.firstContext
			  };

	return wip;
};

export function createFiberFromElement(element: ReactElementType): FiberNode {
	const { type, key, props, ref } = element;
	let fiberTag: WorkTag = FunctionComponent;

	if (typeof type === 'string') {
		// <div/> type: 'div'
		fiberTag = HostComponent;
	} else if (typeof type === 'object') {
		switch (type.$$typeof) {
			case REACT_PROVIDER_TYPE:
				fiberTag = ContextProvider;
				break;
			case REACT_MEMO_TYPE:
				fiberTag = MemoComponent;
				break;
      case REACT_LAZY_TYPE:
        fiberTag = LazyComponent
			default:
				console.warn('未定义的type类型', element);
				break;
		}
	} else if (type === REACT_SUSPENSE_TYPE) {
		fiberTag = SuspenseComponent;
	} else if (typeof type !== 'function' && __DEV__) {
		console.warn('为定义的type类型', element);
	}
	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	fiber.ref = ref;
	return fiber;
}

export function createFiberFromFragment(elements: any[], key: Key): FiberNode {
	const fiber = new FiberNode(Fragment, elements, key);
	return fiber;
}

export interface OffscreenProps {
	mode: 'visible' | 'hidden';
	children: any;
}

export function createFiberFromOffscreen(pendingProps: OffscreenProps) {
	const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
	// TODO stateNode
	return fiber;
}
