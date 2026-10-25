import type { screen } from '@testing-library/react-native';

type Element = ReturnType<typeof screen.getByTestId>;

// The URI an image element shows. expo-image forwards its source as an array
// of sources, React Native's image as one object.
export function imageUri(element: Element): string | undefined {
  const source = element.props.source;
  return (Array.isArray(source) ? source[0] : source)?.uri;
}
