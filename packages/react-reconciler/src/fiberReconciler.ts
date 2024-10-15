import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_runWithPriority
} from 'scheduler';
import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import { requestUpdateLane } from './fiberLanes';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { HostRoot } from './workTags';

// 创建 hostRootFiber
export function createContainer(container: Container) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null);
	const root = new FiberRootNode(container, hostRootFiber);
	hostRootFiber.updateQueue = createUpdateQueue();
	return root;
}

// 更新 hostRootFiber，调用 render 方法时就会调用这个
export function updateContainer(
	element: ReactElementType | null,
	root: FiberRootNode
) {
	unstable_runWithPriority(unstable_ImmediatePriority, () => {
		const hostRootFiber = root.current;
		const lane = requestUpdateLane();
		// 创建一个更新
		const update = createUpdate<ReactElementType | null>(element, lane);
		// 并且将更新插入到 updateQueue 中
		enqueueUpdate(
			hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
			update,
			hostRootFiber,
			lane
		);
		// 调用一下 scheduleUpdateOnFiber 方法来串联到 workLoop 更新流程中
		scheduleUpdateOnFiber(hostRootFiber, lane);
	});
	return element;
}
