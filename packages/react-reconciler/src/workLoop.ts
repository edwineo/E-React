import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitLayoutEffects,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	createWorkInProgress,
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects
} from './fiber';
import {
	HostEffectMask,
	MutationMask,
	NoFlags,
	PassiveMask
} from './fiberFlags';
import {
	getHighestPriorityLane,
	getNextLane,
	Lane,
	lanesToSchedulerPriority,
	markRootFinished,
	markRootSuspended,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_NormalPriority as NormalPriority,
	unstable_shouldYield,
	unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';
import { throwException } from './fiberThrow';
import { SuspenseException, getSuspenseThenable } from './thenable';
import { unwindWork } from './fiberUnwindWork';
import { resetHooksOnUnwind } from './fiberHooks';

let workInProgress: FiberNode | null = null; // 正在执行更新工作的树
let wipRootRenderLane: Lane = NoLane;
let rootDoesHasPassiveEffects = false;

type RootExitStatus = number;
// 工作中的状态
const RootInProgress = 0;
// 并发中间状态
const RootInComplete = 1;
// 完成状态
const RootCompleted = 2;
// 未完成状态，不用进入commit阶段
const RootDidNotComplete = 3;
let workInProgressRootExitStatus: number = RootInProgress;

// Suspense
type SuspendedReason =
	| typeof NotSuspended
	| typeof SuspendedOnError
	| typeof SuspendedOnData
	| typeof SuspendedOnDeprecatedThrowPromise;
const NotSuspended = 0;
const SuspendedOnError = 1;
const SuspendedOnData = 2;
const SuspendedOnDeprecatedThrowPromise = 4;

let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
let workInProgressThrownValue: any = null;

// TODO 执行过程中报错了

// 让 workInProgress 树指向我们需要遍历的第一个 FiberNode 节点
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// 这里的第一个入参一定是 fiberRootNode 而不是普通的 fiberNode
	root.finishedLane = NoLane;
	root.finishedWork = null;
	// 而 fiberRootNode 不能像普通的 fiberNode 一样拿来直接当 workInProgress，需要进一步处理一下，所以用到了 createWorkInProgress 方法
	workInProgress = createWorkInProgress(root.current, {});
	wipRootRenderLane = lane;

	workInProgressRootExitStatus = RootInProgress;
	workInProgressSuspendedReason = NotSuspended;
	workInProgressThrownValue = null;
}

// 将 fiberReconciler 文件中的触发更新相关的流程，接入到 workLoop 中
// 名称意思是：在 Fiber 中调度 update
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// fiberRootNode
	// 对于首屏渲染，传入的是 hostRootFiber，对于后续 setState 更新，传入的就是 classComponent 对应的 fiber

	// 先拿到 fiberRootNode
	const root = markUpdateLaneFromFiberToRoot(fiber, lane);
	// 从 fiberRootNode 开始我们的更新流程
	markRootUpdated(root, lane);
	ensureRootIsScheduled(root);
}

// schedule阶段入口
export function ensureRootIsScheduled(root: FiberRootNode) {
	const updateLane = getNextLane(root);
	const existingCallback = root.callbackNode;

	if (updateLane === NoLane) {
		if (existingCallback !== null) {
			unstable_cancelCallback(existingCallback);
		}
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}

	const curPriority = updateLane;
	const prevPriority = root.callbackPriority;

	if (curPriority === prevPriority) {
		return;
	}

	if (existingCallback !== null) {
		unstable_cancelCallback(existingCallback);
	}
	let newCallbackNode = null;

	if (__DEV__) {
		console.log(
			`在${updateLane === SyncLane ? '微' : '宏'}任务中调度，优先级：`,
			updateLane
		);
	}

	if (updateLane === SyncLane) {
		// 同步优先级 用微任务调度
		// [performSyncWorkOnRoot, performSyncWorkOnRoot, performSyncWorkOnRoot]
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级 用宏任务调度
		const schedulerPriority = lanesToSchedulerPriority(updateLane);

		newCallbackNode = scheduleCallback(
			schedulerPriority,
			// @ts-ignore
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}
	root.callbackNode = newCallbackNode;
	root.callbackPriority = curPriority;
}

export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 从当前 fiber 向上遍历到根节点
export function markUpdateLaneFromFiberToRoot(fiber: FiberNode, lane: Lane) {
	let node = fiber; // 当前节点
	let parent = node.return; // 父节点
	// 当 node.return 为 null 时，就表明当前节点是一个普通的 FiberNode，而不是 hostRootFiber（这个节点只通过 stateNode 来指向父亲节点 FiberRootNode）
	while (parent !== null) {
		// 普通的 fiberNode，则将其赋值为它的父亲，然后将其父节点，赋值为父亲的父亲，依次往上
		parent.childLanes = mergeLanes(parent.childLanes, lane);
		const alternate = parent.alternate;
		if (alternate !== null) {
			alternate.childLanes = mergeLanes(alternate.childLanes, lane);
		}

		node = parent;
		parent = node.return;
	}
	// 如果跳出了上述循环，则表明到了 hostRootFiber 这一步，则直接返回它的 stateNode，也就是父节点
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
}

function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	// 保证useEffect回调执行
	const curCallback = root.callbackNode;
	const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
	if (didFlushPassiveEffect) {
		if (root.callbackNode !== curCallback) {
			return null;
		}
	}

	const lane = getNextLane(root);
	const curCallbackNode = root.callbackNode;
	if (lane === NoLane) {
		return null;
	}
	const needSync = lane === SyncLane || didTimeout;
	// render阶段
	const exitStatus = renderRoot(root, lane, !needSync);

	switch (exitStatus) {
		// 中断
		case RootInComplete:
			if (root.callbackNode !== curCallbackNode) {
				return null;
			}
			return performConcurrentWorkOnRoot.bind(null, root);
		case RootCompleted:
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			root.finishedLane = lane;
			wipRootRenderLane = NoLane;
			commitRoot(root);
			break;
		case RootDidNotComplete:
			markRootSuspended(root, lane);
			wipRootRenderLane = NoLane;
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.error('还未实现的并发更新结束状态');
			}
	}
}

function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getNextLane(root);

	if (nextLane !== SyncLane) {
		// 其他比SyncLane低的优先级
		// NoLane
		ensureRootIsScheduled(root);
		return;
	}

	const exitStatus = renderRoot(root, nextLane, false);

	switch (exitStatus) {
		case RootCompleted:
			const finishedWork = root.current.alternate;
			root.finishedWork = finishedWork;
			root.finishedLane = nextLane;
			wipRootRenderLane = NoLane;
			commitRoot(root);
			break;
		case RootDidNotComplete:
			wipRootRenderLane = NoLane;
			markRootSuspended(root, nextLane);
			ensureRootIsScheduled(root);
			break;
		default:
			if (__DEV__) {
				console.error('还未实现的同步更新结束状态');
			}
			break;
	}
}

let c = 0;

// 整体的渲染方法
function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
	}

	if (wipRootRenderLane !== lane) {
		// 初始化
		// 让 workInProgress 树指向我们需要遍历的第一个 FiberNode 节点
		prepareFreshStack(root, lane);
	}

	do {
		try {
			if (
				workInProgressSuspendedReason !== NotSuspended &&
				workInProgress !== null
			) {
				const thrownValue = workInProgressThrownValue;

				workInProgressSuspendedReason = NotSuspended;
				workInProgressThrownValue = null;

				throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
			}

			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			c++;
			if (c > 20) {
				break;
				console.warn('break!');
			}
			handleThrow(root, e);
		}
	} while (true);

	if (workInProgressRootExitStatus !== RootInProgress) {
		return workInProgressRootExitStatus;
	}

	// 中断执行
	if (shouldTimeSlice && workInProgress !== null) {
		return RootInComplete;
	}
	// render阶段执行完
	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		console.error(`render阶段结束时wip不应该不是null`);
	}
	return RootCompleted;
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}
	const lane = root.finishedLane;

	if (lane === NoLane && __DEV__) {
		console.error('commit阶段finishedLane不应该是NoLane');
	}

	// 重置
	root.finishedWork = null;
	root.finishedLane = NoLane;

	markRootFinished(root, lane);

	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subtreeFlags & PassiveMask) !== NoFlags
	) {
		if (!rootDoesHasPassiveEffects) {
			rootDoesHasPassiveEffects = true;
			// 调度副作用
			scheduleCallback(NormalPriority, () => {
				// 执行副作用
				flushPassiveEffects(root.pendingPassiveEffects);
				return;
			});
		}
	}

	// 分别判断，是否存在3个子阶段需要执行的操作
	// root flags root subtreeFlags
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags;
	const rootHasEffect =
		(finishedWork.flags & (MutationMask | PassiveMask)) !== NoFlags;

	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation
		// mutation Placement
		commitMutationEffects(finishedWork, root);

		root.current = finishedWork;

		// 阶段3/3:Layout
		commitLayoutEffects(finishedWork, root);
	} else {
		root.current = finishedWork;
	}

	rootDoesHasPassiveEffects = false;
	ensureRootIsScheduled(root);
}

function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	let didFlushPassiveEffect = false;
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});
	pendingPassiveEffects.unmount = [];

	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update = [];
	flushSyncCallbacks();
	return didFlushPassiveEffect;
}

function workLoopSync() {
	// 只要 workInProgress 树不为空，就一直循环
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}
function workLoopConcurrent() {
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane); // next 可能是 fiber 的子 fiber，则继续往下遍历；也可能是 null，就停止遍历
	fiber.memoizedProps = fiber.pendingProps; // 先缓存

	if (next === null) {
		// fiber 为 null 了，就停止遍历，开始“归”的过程
		completeUnitOfWork(fiber);
	} else {
		// 如果 fiber 子节点不是 null，就继续往下遍历
		workInProgress = next;
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;

	do {
		// 此时是没有子节点的情况了，所以检查遍历兄弟节点
		completeWork(node);
		const sibling = node.sibling;

		if (sibling !== null) {
			workInProgress = sibling;
			return;
		}
		// 如果没有兄弟节点了，则往上归，此时取的就是父亲节点
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}

function handleThrow(root: FiberRootNode, thrownValue: any): void {
	/*
		throw可能的情况
			1. use thenable
			2. error (Error Boundary处理)
	*/
	if (thrownValue === SuspenseException) {
		workInProgressSuspendedReason = SuspendedOnData;
		thrownValue = getSuspenseThenable();
	} else {
		const isWakeable =
			thrownValue !== null &&
			typeof thrownValue === 'object' &&
			typeof thrownValue.then === 'function';

		workInProgressThrownValue = thrownValue;
		workInProgressSuspendedReason = isWakeable
			? SuspendedOnDeprecatedThrowPromise
			: SuspendedOnError;
	}
	workInProgressThrownValue = thrownValue;
}

function throwAndUnwindWorkLoop(
	root: FiberRootNode,
	unitOfWork: FiberNode,
	thrownValue: any,
	lane: Lane
) {
	// unwind前的重置hook，避免 hook0 use hook1 时 use造成中断，再恢复时前后hook对应不上
	resetHooksOnUnwind(unitOfWork);
	throwException(root, thrownValue, lane);
	unwindUnitOfWork(unitOfWork);
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
	let incompleteWork: FiberNode | null = unitOfWork;
	do {
		const next = unwindWork(incompleteWork);

		if (next !== null) {
			next.flags &= HostEffectMask;
			workInProgress = next;
			return;
		}

		const returnFiber = incompleteWork.return as FiberNode;
		if (returnFiber !== null) {
			returnFiber.deletions = null;
		}
		incompleteWork = returnFiber;
		// workInProgress = incompleteWork;
	} while (incompleteWork !== null);

	// 没有 边界 中止unwind流程，一直到root
	workInProgress = null;
	workInProgressRootExitStatus = RootDidNotComplete;
}
