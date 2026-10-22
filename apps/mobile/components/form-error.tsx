import { Text } from '@/components/ui/text';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text role="alert" className="text-destructive text-sm">
      {message}
    </Text>
  );
}
