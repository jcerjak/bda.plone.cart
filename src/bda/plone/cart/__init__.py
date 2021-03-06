import urllib2
from decimal import Decimal
from zope.interface import (
    implementer,
    Interface,
)
from zope.component import (
    adapter,
    getMultiAdapter,
)
from zope.i18n import translate
from zope.i18nmessageid import MessageFactory
from zope.publisher.interfaces.browser import IBrowserRequest
from Products.CMFCore.utils import getToolByName
from bda.plone.shipping import Shippings
from .interfaces import (
    ICartItem,
    ICartDataProvider,
    ICartItemDataProvider,
    ICartItemAvailability,
    ICartItemPreviewImage,
    ICartItemStock,
    ICartItemState,
)


_ = MessageFactory('bda.plone.cart')


def ascur(val, comma=False):
    """Convert float value to currency string.

    comma:
         True for ```,``` instead of ```.```.
    """
    val = '%.2f' % val
    if comma:
        return val.replace('.', ',')
    return val


def readcookie(request):
    """Read, unescape and return the cart cookie.
    """
    return urllib2.unquote(request.cookies.get('cart', ''))


def deletecookie(request):
    """Delete the cart cookie.
    """
    request.response.expireCookie('cart', path='/')


def extractitems(items):
    """Cart items are stored in a cookie. The format is
    ``uid:count,uid:count,...``.

    Return a list of 3-tuples containing ``(uid, count, comment)``.
    """
    if not items:
        return []
    ret = list()
    items = urllib2.unquote(items).split(',')
    for item in items:
        if not item:
            continue
        item = item.split(':')
        uid = item[0].split(';')[0]
        count = item[1]
        comment = item[0][len(uid) + 1:]
        try:
            ret.append((uid, Decimal(count), comment))
        except ValueError, e:
            # item[1] may be a 'NaN' -> Should be ok with Decimal now.
            print e
            pass
    return ret


def aggregate_cart_item_count(target_uid, items):
    """Aggregate count for items in cart with target uid.
    """
    aggregated_count = 0
    for uid, count, comment in items:
        if target_uid == uid:
            aggregated_count += count
    return aggregated_count


@implementer(ICartDataProvider)
@adapter(Interface, IBrowserRequest)
class CartDataProviderBase(object):

    def __init__(self, context, request):
        self.context = context
        self.request = request

    @property
    def disable_max_article(self):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``disable_max_article``.")

    @property
    def summary_total_only(self):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``summary_total_only``.")

    @property
    def checkout_url(self):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``checkout_url``.")

    def net(self, items):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``net``.")

    def vat(self, items):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``vat``.")

    def cart_items(self, items):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``cart_items``.")

    @property
    def include_shipping_costs(self):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``include_shipping_costs``.")

    @property
    def shipping_method(self):
        raise NotImplementedError(u"CartDataProviderBase does not implement "
                                  u"``shipping_method``.")

    @property
    def currency(self):
        return 'EUR'

    @property
    def cart_url(self):
        return '%s/@@cart' % self.context.absolute_url()

    @property
    def show_to_cart(self):
        return True

    @property
    def show_checkout(self):
        return False

    @property
    def show_currency(self):
        return True

    def validate_set(self, uid):
        """By default, all items generally may be set.
        """
        return {'success': True, 'error': ''}

    def validate_count(self, uid, count):
        cart_item = get_object_by_uid(self.context, uid)
        item_state = get_item_state(cart_item, self.request)
        if item_state.validate_count(count):
            return {'success': True, 'error': ''}
        message = translate(_('trying_to_add_more_items_than_available',
                              default="Not enough items available, abort."),
                            context=self.request)
        return {'success': False, 'error': message}

    def shipping(self, items):
        shippings = Shippings(self.context)
        shipping = shippings.get(self.shipping_method)
        return shipping.calculate(items)

    def item(self, uid, title, count, price, url, comment='', description='',
             comment_required=False, quantity_unit_float=False,
             quantity_unit='', preview_image_url='',
             no_longer_available=False, alert=''):
        return {
            # placeholders
            'cart_item_uid': uid,
            'cart_item_title': title,
            'cart_item_count': count,
            'cart_item_price': ascur(price),
            'cart_item_location:href': url,
            'cart_item_preview_image:src': preview_image_url,
            'cart_item_comment': comment,
            'cart_item_description': description,
            'cart_item_quantity_unit': quantity_unit,
            'cart_item_alert': alert,
            # control flags
            'comment_required': comment_required,
            'quantity_unit_float': quantity_unit_float,
            'no_longer_available': no_longer_available,
        }

    @property
    def data(self):
        ret = {
            'cart_items': list(),
            'cart_summary': dict(),
        }
        items = extractitems(self.request.form.get('items'))
        if items:
            net = self.net(items)
            vat = self.vat(items)
            cart_items = self.cart_items(items)
            ret['cart_items'] = cart_items
            ret['cart_summary']['cart_net'] = ascur(net)
            ret['cart_summary']['cart_vat'] = ascur(vat)
            if self.include_shipping_costs:
                shipping = self.shipping(items)
                ret['cart_summary']['cart_shipping'] = ascur(shipping)
                ret['cart_summary']['cart_total'] = ascur(net + vat + shipping)
            else:
                ret['cart_summary']['cart_total'] = ascur(net + vat)
            ret['cart_summary']['cart_total_raw'] = net + vat
        return ret


AVAILABILITY_CRITICAL_LIMIT = 5.0


@implementer(ICartItemAvailability)
@adapter(ICartItem, IBrowserRequest)
class CartItemAvailabilityBase(object):
    """Base cart item availability display behavior adapter.
    """

    def __init__(self, context, request):
        self.context = context
        self.request = request

    @property
    def stock(self):
        return get_item_stock(self.context)

    @property
    def available(self):
        available = self.stock.available
        # reduce available count if item already in cart
        if available is not None:
            cart_items = extractitems(readcookie(self.request))
            item_uid = self.context.UID()
            for uid, count, comment in cart_items:
                if uid == item_uid:
                    available -= float(count)
        return available

    @property
    def overbook(self):
        return self.stock.overbook

    @property
    def critical_limit(self):
        return AVAILABILITY_CRITICAL_LIMIT

    @property
    def addable(self):
        """Default addable rules:

        * if available None, no availability defined, unlimited addable
        * if overbook is None, unlimited overbooking
        * if available > overbook * -1, addable
        * not addable atm
        """
        if self.available is None:
            return True
        if self.overbook is None:
            return True
        if self.available > self.overbook * -1:
            return True
        return False

    @property
    def signal(self):
        """Default signal rules:

        * if available is None, green
        * if available > limit, green
        * if available > 0, yellow
        * if self.overbook is None, orange
        * if available > self.overbook * -1, orange
        * else, red
        """
        available = self.available
        if available is None:
            return 'green'
        if available > self.critical_limit:
            return 'green'
        if available > 0:
            return 'yellow'
        if self.overbook is None:
            return 'orange'
        if available > self.overbook * -1:
            return 'orange'
        return 'red'

    @property
    def details(self):
        raise NotImplementedError(u"CartItemAvailabilityBase does not "
                                  u"implement ``details``.")


@implementer(ICartItemState)
@adapter(ICartItem, IBrowserRequest)
class CartItemStateBase(object):
    """Base cart item state implementation.
    """

    def __init__(self, context, request):
        self.context = context
        self.request = request

    @property
    def aggregated_count(self):
        items = extractitems(readcookie(self.request))
        return aggregate_cart_item_count(self.context.UID(), items)

    @property
    def reserved(self):
        aggregated_count = float(self.aggregated_count)
        stock = get_item_stock(self.context)
        available = stock.available
        reserved = 0.0
        if available <= 0:
            reserved = aggregated_count
        elif available - aggregated_count < 0:
            reserved = abs(available - aggregated_count)
        return reserved

    @property
    def exceed(self):
        stock = get_item_stock(self.context)
        overbook = stock.overbook
        reserved = self.reserved
        exceed = 0.0
        if overbook is not None:
            if reserved > overbook:
                exceed = reserved - overbook
        return exceed

    @property
    def remaining_available(self):
        stock = get_item_stock(self.context)
        available = stock.available
        overbook = stock.overbook
        if available >= 0:
            remaining_available = available + overbook
        else:
            remaining_available = overbook - available
        return remaining_available

    def validate_count(self, count):
        count = float(count)
        stock = get_item_stock(self.context)
        available = stock.available
        overbook = stock.overbook
        if available is None or overbook is None:
            return True
        available -= count
        if available >= overbook * -1:
            return True
        return False

    def alert(self, count):
        raise NotImplementedError(u"CartItemStateBase does not "
                                  u"implement ``alert``.")


@implementer(ICartItemPreviewImage)
class CartItemPreviewAdapterBase(object):

    def __init__(self, context):
        self.context = context

    @property
    def url(self):
        raise NotImplementedError(
            u"CartItemPreviewAdapterBase does not implement ``url``.")


def get_data_provider(context, request=None):
    """Return ICartDataProvider implementation.
    """
    if request is None:
        request = context.REQUEST
    return getMultiAdapter((context, request), ICartDataProvider)


def get_item_data_provider(context):
    """Return ICartItemDataProvider implementation.
    """
    return ICartItemDataProvider(context)


def get_item_stock(context):
    """Return ICartItemStock implementation.
    """
    return ICartItemStock(context)


def get_item_availability(context, request=None):
    """Return ICartItemAvailability implementation.
    """
    if request is None:
        request = context.REQUEST
    return getMultiAdapter((context, request), ICartItemAvailability)


def get_item_state(context, request=None):
    """Return ICartItemState implementation.
    """
    if request is None:
        request = context.REQUEST
    return getMultiAdapter((context, request), ICartItemState)


def get_item_preview(context):
    """Return ICartItemPreviewImage implementation.
    """
    return ICartItemPreviewImage(context)


def get_catalog_brain(context, uid):
    cat = getToolByName(context, 'portal_catalog')
    brains = cat(UID=uid)
    if brains:
        if len(brains) > 1:
            raise RuntimeError(
                u"FATAL: duplicate objects with same UID found.")
        return brains[0]
    return None


def get_object_by_uid(context, uid):
    brain = get_catalog_brain(context, uid)
    if brain:
        return brain.getObject()
    return None
