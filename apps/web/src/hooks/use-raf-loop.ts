import { useEffect, useRef } from "react";

export function useRafLoop(callback: ({ time }: { time: number }) => void) {
	const callbackRef = useRef(callback);
	callbackRef.current = callback;
	const requestRef = useRef<number>(0);
	const previousTimeRef = useRef<number | null>(null);

	useEffect(() => {
		const loop = (time: number) => {
			if (previousTimeRef.current !== null) {
				callbackRef.current({ time: time - previousTimeRef.current });
			}
			previousTimeRef.current = time;
			requestRef.current = requestAnimationFrame(loop);
		};

		requestRef.current = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(requestRef.current);
	}, []); // stable — loop never restarts
}
