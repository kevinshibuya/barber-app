import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

// The frame of every screen: the safe area and the page padding.
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <SafeAreaView className={cn('bg-background flex-1 gap-4 p-6', className)}>{children}</SafeAreaView>;
}
