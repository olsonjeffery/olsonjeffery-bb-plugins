// CSS imports are real files; the bundler picks them up for the app bundle.
declare module "*.css" {
  const value: unknown;
  export default value;
}
