// The pager is native; in tests its pages lay out in a plain View. A test
// swipes with `fireEvent(pager, 'pageSelected', { nativeEvent: { position } })`,
// and `setPage` selects a page the same way.
const React = require('react');
const { View } = require('react-native');

class PagerView extends React.Component {
  setPage = (position) => this.props.onPageSelected?.({ nativeEvent: { position } });
  setPageWithoutAnimation = (position) => this.setPage(position);
  render() {
    return React.createElement(View, this.props);
  }
}

module.exports = { __esModule: true, default: PagerView, PagerView };
