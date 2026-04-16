export type WechatTemplateType = 'BOOKING_SUCCESS' | 'BOOKING_REMINDER';

export interface WechatTemplateConfigItem {
    templateId: string;
    page?: string;
    fields: Record<string, string>;
}

export const wechatTemplateConfig: Record<
    WechatTemplateType,
    WechatTemplateConfigItem
> = {
    BOOKING_SUCCESS: {
        templateId:
            process.env.WECHAT_TEMPLATE_BOOKING_SUCCESS ||
            'TEMPLATE_ID_BOOKING_SUCCESS',
        page: 'pages/booking/detail/detail',
        fields: {
            title: 'thing1',
            bookingTime: 'date2',
            seatInfo: 'thing3',
            location: 'thing4',
            remark: 'phrase5',
        },
    },
    BOOKING_REMINDER: {
        templateId:
            process.env.WECHAT_TEMPLATE_BOOKING_REMINDER ||
            'TEMPLATE_ID_BOOKING_REMINDER',
        page: 'pages/booking/detail/detail',
        fields: {
            title: 'phrase1',
            bookingTime: 'date2',
            seatInfo: 'thing3',
            location: 'thing4',
            remark: 'thing5',
        },
    },
};

export function buildWechatTemplatePayload(
    templateType: WechatTemplateType,
    data: Record<string, any> = {}
) {
    const config = wechatTemplateConfig[templateType];
    if (!config) return null;

    const payload: Record<string, { value: string }> = {};
    Object.entries(config.fields).forEach(([bizKey, templateKey]) => {
        const value = data[bizKey];
        payload[templateKey] = {
            value: value !== undefined && value !== null ? String(value) : '',
        };
    });
    return payload;
}
