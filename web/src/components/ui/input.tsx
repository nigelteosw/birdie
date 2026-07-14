import * as React from 'react';
import { cn } from '../../lib/utils.js';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn('ui-input', className)} {...props} />
));
Input.displayName = 'Input';

export { Input };
