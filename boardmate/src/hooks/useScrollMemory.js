import { useCallback, useRef } from 'react';

// Detail pages unmount the dashboard DOM while keeping its component state.
// Remember the list position as the scroll element detaches, then restore it.
export default function useScrollMemory() {
  const element = useRef(null);
  const position = useRef(0);
  return useCallback(node => {
    if (element.current) position.current = element.current.scrollTop;
    element.current = node;
    if (node) node.scrollTop = position.current;
  }, []);
}
