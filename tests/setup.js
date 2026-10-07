// jsdom has no native dialog top layer. Real browser QA checks focus and Escape.
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
