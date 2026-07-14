import * as React from 'react';
import { cn } from '../../lib/utils.js';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('ui-textarea', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export { Textarea };
