// Dependencies: $, cookie_functions.js

(function($) {

    $(document).ready(function() {
        if ($('.disable_max_article').length) {
            CART_MAX_ARTICLE_COUNT = 100000;
        }
        var execution_context = $('.cart_execution_context');
        if (execution_context.length) {
            CART_EXECUTION_CONTEXT = execution_context.text();
        }
        cart.init();
        cart.query();
        if (typeof(window['Faceted']) != "undefined") {
            $(Faceted.Events).bind(Faceted.Events.AJAX_QUERY_SUCCESS,
                                   function(e){
                cart.bind();
            });
        }
        if (typeof(window['bdajax']) != "undefined") {
            $.extend(bdajax.binders, {
                cart_binder: cart.bind
            });
        }
    });

    CART_EXECUTION_CONTEXT = null;
    CART_HIDE_PORTLET_IF_EMPTY = false;
    CART_PORTLET_IDENTIFYER = '#portlet-cart';
    CART_MAX_ARTICLE_COUNT = 5;

    function Cart() {
        // flag whether cart contains items which are no longer available
        this.no_longer_available = false;
    }

    Cart.prototype.messages = {
        article_limit_reached: "Die gewünschte Bestellmenge übersteigt die " +
            "maximale Bestellmenge für diesen Artikel.",
        total_limit_reached: "Die gewünschte Bestellmenge übersteigt die " +
            "maximale Gesamtbestellmenge.",
        not_a_number: "Die Eingabe ist keine Zahl",
        max_unique_articles_reached: "Die maximale Anzahl von verschiedenen " +
            "Artikeln wurde erreicht. Es ist nicht möglicg, weiter Artikel " +
            "in den Warenkorb zu legen. Bitte schließen Sie die aktuelle " +
            "Bestellung ab.",
        invalid_comment_character: "Ungültiges Zeichen in Kommentar",
        comment_required: "Zusatzangabe ist erforderlich",
        integer_required: "Eingabe muss eine Ganzzahl sein",
        no_longer_available: "Ein oder mehrere Artikel im Warenkorb sind in " +
            "der gewünschten Anzahl nicht oder nur mehr teilweise " +
            "verfügbar. Bitte aktualisieren oder entfernen Sie die " +
            "ensprechenden Artikel vor dem Abschluss Ihres Einkaufs."
    }

    Cart.prototype.init = function() {
        this.cart_node = $('#cart').get(0);
        if (!this.cart_node) {
            return;
        }
        this.item_template = $($('.cart_item').get(0)).clone();
        $('#card_item_template').remove();
    }

    Cart.prototype.add = function(uid, count, comment) {
        if (!this.validateOverallCountAdd(count)) {
            return;
        }
        this.writecookie(uid, count, comment, true);
        this.query(uid);
    }

    Cart.prototype.set = function(uid, count, comment) {
        if (!this.validateOverallCountSet(uid, count)) {
            return;
        }
        this.writecookie(uid, count, comment, false);
        this.query(uid);
    }

    Cart.prototype.writecookie = function(uid, count, comment, add) {
        // XXX: support cookie size > 4096 by splitting up cookie
        count = new Number(count);
        if (comment.indexOf(':') > -1) {
            bdajax.error(cart.messages['invalid_comment_character']);
            return;
        }
        // item uid consists of ``object_uid;comment``
        uid = uid + ';' + comment;
        var items = this.items();
        var existent = false;
        for (var itemuid in items) {
            if (!itemuid) {
                continue;
            }
            if (uid == itemuid) {
                if (add) {
                    items[itemuid] += count;
                } else {
                    items[itemuid] = count;
                }
                existent = true;
                break;
            }
        }
        if (!existent) {
            items[uid] = new Number(count);
        }
        var cookie = '';
        for (var itemuid in items) {
            if (!itemuid || items[itemuid] == 0) {
                continue;
            }
            cookie = cookie + itemuid + ':' + new String(items[itemuid]) + ',';
        }
        if (cookie) {
            cookie = cookie.substring(0, cookie.length - 1);
        }
        if (cookie.length > 4096) {
            bdajax.error(cart.messages['max_unique_articles_reached']);
            return;
        }
        createCookie('cart', cookie);
    }

    Cart.prototype.render = function(data) {
        if (data['cart_items'].length == 0) {
            if (!CART_HIDE_PORTLET_IF_EMPTY) {
                $(CART_PORTLET_IDENTIFYER).css('display', 'block');
            } else {
                $(CART_PORTLET_IDENTIFYER).css('display', 'none');
            }
            $('#cart_items', this.cart_node).css('display', 'none');
            $('#cart_no_items', this.cart_node).css('display', 'block');
            $('#cart_summary', this.cart_node).css('display', 'none');
        } else {
            $(CART_PORTLET_IDENTIFYER).css('display', 'block');
            $('#cart_no_items', this.cart_node).css('display', 'none');
            $('#cart_items', this.cart_node).empty();
            $('#cart_items', this.cart_node).css('display', 'block');
            var render_no_longer_available = false;
            for (var i = 0; i < data['cart_items'].length; i++) {
                var cart_item = $(this.item_template).clone();
                var cart_item_data = data['cart_items'][i];
                // item control flags
                var quantity_unit_float = cart_item_data.quantity_unit_float;
                var comment_required = cart_item_data.comment_required;
                var no_longer_available = cart_item_data.no_longer_available;
                // delete item control flags from cart_item_data
                delete cart_item_data.quantity_unit_float;
                delete cart_item_data.comment_required;
                delete cart_item_data.no_longer_available;
                if (no_longer_available) {
                    $('input', cart_item).prop('disabled', true);
                    $('input.cart_item_count', cart_item)
                        .prop('disabled', false)
                        .css('background-color', 'red');
                    render_no_longer_available = true;
                }
                for (var item in cart_item_data) {
                    var attribute = '';
                    var css = '.' + item;
                    if (item.indexOf(':') != -1) {
                        attribute = item.substring(item.indexOf(':') + 1,
                                                   item.length);
                        css = css.substring(0, item.indexOf(':') + 1);
                    }
                    var value = cart_item_data[item];
                    if (item == 'cart_item_comment' && !value) {
                        $('.cart_item_comment_wrapper', cart_item).hide();
                    }
                    if (item == 'cart_item_alert') {
                        $('.cart_item_alert', cart_item).show();
                    }
                    var placeholder = $(css, cart_item);
                    $(placeholder).each(function(e) {
                        // case set attribute of element
                        if (attribute != '') {
                            $(this).attr(attribute, value);
                        // case element is input
                        } else if (this.tagName.toUpperCase() == 'INPUT') {
                            // check if comment and set required class
                            var is_comment = item == 'cart_item_comment';
                            if (is_comment && comment_required) {
                                $(this).addClass('required');
                            }
                            // check if count and set quantity_unit_float class
                            var is_count = item == 'cart_item_count';
                            if (is_count && quantity_unit_float) {
                                $(this).addClass('quantity_unit_float');
                                value = cart.round(value);
                            }
                            $(this).attr('value', value);
                            $(this).val(value);
                        // case set element text
                        } else {
                            // not count element, set value
                            var is_count = item == 'cart_item_count';
                            if (!is_count) {
                                $(this).html(value);
                            // if count element has 'style' attribute 'display'
                            // set to 'none', do not change it's value. This is
                            // necessary for cart item removal.
                            } else {
                                var mode = $(this).css('display');
                                if (mode.toLowerCase() != 'none') {
                                    $(this).html(value);
                                }
                            }
                        }
                    });
                }
                $('#cart_items', this.cart_node).append(cart_item);
            }
            var cart_summary = $('#cart_summary', this.cart_node).get(0);
            for (var item in data['cart_summary']) {
                var css = '.' + item;
                var value = data['cart_summary'][item];
                $(css, cart_summary).html(value);
            }
            $('#cart_summary', this.cart_node).css('display', 'block');
            if (render_no_longer_available) {
                this.no_longer_available = true;
                bdajax.warning(cart.messages['no_longer_available']);
            } else {
                this.no_longer_available = false;
            }
        }
    }

    Cart.prototype.bind = function(context) {
        $('.prevent_if_no_longer_available', context)
            .unbind('click')
            .bind('click', function(e) {
                if (cart.no_longer_available) {
                    e.preventDefault();
                    bdajax.warning(cart.messages['no_longer_available']);
                }
            });
        $('.add_cart_item', context).each(function() {
            $(this).unbind('click');
            $(this).bind('click', function(e) {
                e.preventDefault();
                var defs;
                try {
                    defs = cart.extract(this);
                } catch (ex) {
                    bdajax.error(ex.message);
                    return;
                }
                var uid = defs[0];
                var count = defs[1];
                var items = cart.items();
                for (var item in items) {
                    if (!item) {
                        continue;
                    }
                    var item_uid = item.split(';')[0];
                    if (uid == item_uid) {
                        count += items[item];
                    }
                }
                var params = {
                    uid: defs[0],
                    count: count + ''
                };
                if (CART_EXECUTION_CONTEXT) {
                    params.execution_context = CART_EXECUTION_CONTEXT;
                }
                bdajax.request({
                    url: 'validate_cart_item',
                    params: params,
                    type: 'json',
                    success: function(data) {
                        if (data.success == false) {
                            var msg;
                            if (data.error) {
                                msg = data.error;
                            } else {
                                msg = cart.messages['article_limit_reached'];
                            }
                            bdajax.info(unescape(msg));
                        } else {
                            cart.add(defs[0], defs[1], defs[2]);
                            var evt = $.Event('cart_modified');
                            evt.uid = defs[0];
                            evt.count = count;
                            $('*').trigger(evt);
                        }
                    }
                });
            });
        });
        $('.update_cart_item', context).each(function() {
            $(this).unbind('click');
            $(this).bind('click', function(e) {
                e.preventDefault();
                var defs;
                try {
                    defs = cart.extract(this);
                } catch (ex) {
                    bdajax.error(ex.message);
                    return;
                }
                var uid = defs[0];
                var count = defs[1];
                if (count > 0) {
                    var items = cart.items();
                    for (var item in items) {
                        if (!item) {
                            continue;
                        }
                        if (item == uid + ';' + defs[2]) {
                            continue;
                        }
                        var item_uid = item.split(';')[0];
                        if (uid == item_uid) {
                            count += items[item];
                        }
                    }
                }
                var params = {
                    uid: defs[0],
                    count: count + ''
                };
                if (CART_EXECUTION_CONTEXT) {
                    params.execution_context = CART_EXECUTION_CONTEXT;
                }
                bdajax.request({
                    url: 'validate_cart_item',
                    params: params,
                    type: 'json',
                    success: function(data) {
                        if (data.success == false) {
                            var msg;
                            if (data.error) {
                                msg = data.error;
                            } else {
                                msg = cart.messages['article_limit_reached'];
                            }
                            bdajax.info(unescape(msg));
                        } else {
                            cart.set(defs[0], defs[1], defs[2]);
                            var evt = $.Event('cart_modified');
                            evt.uid = defs[0];
                            evt.count = count;
                            $('*').trigger(evt);
                        }
                    }
                });
            });
        });
    }

    Cart.prototype.round = function(x) {
        var ret = (Math.round(x * 100) / 100).toString();
        ret += (ret.indexOf('.') == -1) ? '.00' : '00';
        return ret.substring(0, ret.indexOf('.') + 3);
    }

    Cart.prototype.extract = function(node) {
        node = $(node);
        var parents = node.parents();
        var uid = $('.cart_item_uid', parents).first().text();
        var count_node = $('.cart_item_count', parents).get(0);
        var count;
        if (count_node.tagName.toUpperCase() == 'INPUT') {
            count = $(count_node).val();
        } else {
            count = $(count_node).text();
        }
        count = new Number(count);
        if (isNaN(count)) {
            throw {
                name: 'Number Required',
                message: cart.messages['not_a_number']
            };
        }
        var force_int = !$(count_node).hasClass('quantity_unit_float');
        if (force_int && count > 0 && count % 1 != 0) {
            throw {
                name: 'Integer Required',
                message: cart.messages['integer_required']
            };
        }
        var comment_node = $('.cart_item_comment', parents).get(0);
        var comment = '';
        if (comment_node) {
            if (comment_node.tagName.toUpperCase() == 'INPUT') {
                comment = $(comment_node).val();
                if ($(comment_node).hasClass('required') && !comment.trim()) {
                    throw {
                        name: 'Comment Required',
                        message: cart.messages['comment_required']
                    };
                }
            } else {
                comment = $(comment_node).text();
            }
        }
        return [uid, count, comment];
    }

    Cart.prototype.cookie = function() {
        // XXX: support cookie size > 4096 by splitting up cookie
        var cookie = readCookie('cart');
        if (cookie == null) {
            cookie = '';
        }
        return cookie;
    }

    /*
     * items is a key/value mapping in format items['obj_uid;comment'] = count 
     */
    Cart.prototype.items = function() {
        var cookie = this.cookie();
        var cookieitems = cookie.split(',');
        var items = new Object();
        for (var i = 0; i < cookieitems.length; i++) {
            var item = cookieitems[i].split(':');
            items[item[0]] = new Number(item[1]);
        }
        return items;
    }

    Cart.prototype.validateOverallCountAdd = function(addcount) {
        var count = 0;
        var items = this.items();
        for (var item in items) {
            if (!item) {
                continue;
            }
            count += items[item];
        }
        count += new Number(addcount);
        if (count > CART_MAX_ARTICLE_COUNT) {
            var msg;
            msg = cart.messages['total_limit_reached'];
            bdajax.info(unescape(msg));
            return false;
        }
        return true;
    }

    Cart.prototype.validateOverallCountSet = function(uid, setcount) {
        var count = 0;
        var items = this.items();
        for (var item in items) {
            if (!item) {
                continue;
            }
            var item_uid = item.split(';')[0];
            if (uid == item_uid) {
                continue;
            }
            count += items[item];
        }
        count += new Number(setcount);
        if (count > CART_MAX_ARTICLE_COUNT) {
            var msg;
            msg = cart.messages['total_limit_reached'];
            bdajax.info(unescape(msg));
            return false;
        }
        return true;
    }

    /*
     * @param uid_changed: uid of item which was added or set before querying
     */
    Cart.prototype.query = function(uid_changed) {
        // trigger cart_changed event on elements with
        // css class ``cart_item_${uid_changed}``
        if (uid_changed) {
            var evt = $.Event('cart_changed');
            var selector = '.cart_item_' + uid_changed;
            $(selector).trigger(evt);
        }
        if (!this.cart_node) {
            return;
        }
        if (document.location.href.indexOf('/portal_factory/') != -1) {
            return;
        }
        var params = { items: this.cookie() };
        if (CART_EXECUTION_CONTEXT) {
            params.execution_context = CART_EXECUTION_CONTEXT;
        }
        bdajax.request({
            url: 'cartData',
            params: params,
            type: 'json',
            success: function(data) {
                 cart.render(data);
                 cart.bind();
            }
        });
    }

    var cart = new Cart();

})(jQuery);
