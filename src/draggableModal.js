// Pointer-driven positioning for a centered modal.

const EDGE_MARGIN = 12;
const INTERACTIVE_SELECTOR = 'button, input, textarea, select, label, a, [role="button"], [role="switch"], [data-no-drag]';

export function makeModalDraggable(modal, handle, options = {}) {
    if (!modal || !handle || modal.dataset.draggableModal === 'true') return null;
    modal.dataset.draggableModal = 'true';
    const prefix = options.prefix || 'modal';
    const xProperty = `--${prefix}-drag-x`;
    const yProperty = `--${prefix}-drag-y`;
    const draggingClass = options.draggingClass || `${prefix}-dragging`;
    const visibleClass = options.visibleClass || null;
    let drag = null;

    const readOffset = property => Number.parseFloat(modal.style.getPropertyValue(property)) || 0;
    const setOffset = (x, y) => {
        modal.style.setProperty(xProperty, `${Math.round(x)}px`);
        modal.style.setProperty(yProperty, `${Math.round(y)}px`);
    };
    const clamp = () => {
        if (visibleClass && !modal.closest(`.${visibleClass}`)) return;
        const rect = modal.getBoundingClientRect();
        let x = readOffset(xProperty);
        let y = readOffset(yProperty);
        if (rect.left < EDGE_MARGIN) x += EDGE_MARGIN - rect.left;
        if (rect.right > window.innerWidth - EDGE_MARGIN) x -= rect.right - (window.innerWidth - EDGE_MARGIN);
        if (rect.top < EDGE_MARGIN) y += EDGE_MARGIN - rect.top;
        if (rect.bottom > window.innerHeight - EDGE_MARGIN) y -= rect.bottom - (window.innerHeight - EDGE_MARGIN);
        setOffset(x, y);
    };
    const endDrag = event => {
        if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
        if (handle.hasPointerCapture?.(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
        drag = null;
        modal.classList.remove(draggingClass);
    };
    handle.addEventListener('pointerdown', event => {
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest(INTERACTIVE_SELECTOR)) return;
        const rect = modal.getBoundingClientRect();
        const startX = readOffset(xProperty);
        const startY = readOffset(yProperty);
        drag = {
            pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, startX, startY,
            minX: startX + EDGE_MARGIN - rect.left,
            maxX: startX + window.innerWidth - EDGE_MARGIN - rect.right,
            minY: startY + EDGE_MARGIN - rect.top,
            maxY: startY + window.innerHeight - EDGE_MARGIN - rect.bottom,
        };
        handle.setPointerCapture?.(event.pointerId);
        modal.classList.add(draggingClass);
        event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        setOffset(
            Math.min(drag.maxX, Math.max(drag.minX, drag.startX + event.clientX - drag.pointerX)),
            Math.min(drag.maxY, Math.max(drag.minY, drag.startY + event.clientY - drag.pointerY)),
        );
    });
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('dblclick', event => {
        if (!event.target.closest(INTERACTIVE_SELECTOR)) setOffset(0, 0);
    });
    const onResize = () => requestAnimationFrame(clamp);
    window.addEventListener('resize', onResize);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(modal);
    return {
        clamp,
        reset: () => setOffset(0, 0),
        destroy() {
            window.removeEventListener('resize', onResize);
            observer?.disconnect();
        },
    };
}
