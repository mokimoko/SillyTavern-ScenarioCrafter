const dialogs = [];

export function manageDialog(root, close) {
    const previousFocus = document.activeElement;
    const dialog = root.querySelector('.scenariocrafter-modal-content, .scenariocrafter-popup-content') || root;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');
    const title = dialog.querySelector('h2, h3, .scenariocrafter-title');
    dialog.setAttribute('aria-label', title?.textContent.trim() || 'Scenario Crafter');
    const entry = { root };
    dialogs.push(entry);
    const focusable = () => [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const onKey = event => {
        if (dialogs.at(-1) !== entry) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation(); close();
        } else if (event.key === 'Tab') {
            const elements = focusable();
            const first = elements[0] || dialog, last = elements.at(-1) || dialog;
            if (!dialog.contains(document.activeElement)
                || (event.shiftKey && document.activeElement === first)
                || (!event.shiftKey && document.activeElement === last) || !elements.length) {
                event.preventDefault(); (event.shiftKey ? last : first).focus();
            }
        }
    };
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
        if (root.isConnected && dialogs.at(-1) === entry) (focusable()[0] || dialog).focus();
    });
    let released = false;
    return () => {
        if (released) return;
        released = true;
        document.removeEventListener('keydown', onKey, true);
        const index = dialogs.indexOf(entry);
        if (index >= 0) dialogs.splice(index, 1);
        if (previousFocus?.isConnected) previousFocus.focus();
    };
}
