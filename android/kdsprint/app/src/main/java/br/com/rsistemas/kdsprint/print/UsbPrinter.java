package br.com.rsistemas.kdsprint.print;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Log;

import java.util.HashMap;

/**
 * Impressão USB CDC ACM para Bematech MP-4200 TH.
 * Baseado na lógica comprovada do DoRafaKDSPrint/Cantinas.
 *
 * Protocolo:
 *   1. SET_LINE_CODING (115200 8N1)
 *   2. SET_CONTROL_LINE_STATE (DTR+RTS)
 *   3. sleep(200ms)
 *   4. bulkTransfer OUT em chunks
 *   5. SET_CONTROL_LINE_STATE (0x00)
 *   6. releaseInterface + close
 */
public class UsbPrinter {

    private static final String TAG = "PrintBridge";
    public static final String ACTION_USB_PERMISSION = "br.com.rsistemas.kdsprint.USB_PERMISSION";

    private final UsbManager usbManager;
    private final Context context;
    private String lastError = "";

    public UsbPrinter(Context ctx) {
        this.context = ctx.getApplicationContext();
        this.usbManager = (UsbManager) this.context.getSystemService(Context.USB_SERVICE);
    }

    public String getLastError() {
        String e = lastError;
        lastError = "";
        return e;
    }

    /** Localiza a impressora USB (CDC class 2/10 ou VIDs conhecidos). */
    public UsbDevice findPrinterDevice() {
        HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
        if (deviceList == null || deviceList.isEmpty()) return null;
        for (UsbDevice device : deviceList.values()) {
            if (isPrinterDevice(device)) return device;
        }
        return null;
    }

    public boolean hasPermission() {
        UsbDevice d = findPrinterDevice();
        return d != null && usbManager.hasPermission(d);
    }

    public boolean requestPermission() {
        UsbDevice device = findPrinterDevice();
        if (device == null) {
            lastError = "Nenhuma impressora USB encontrada";
            return false;
        }
        if (usbManager.hasPermission(device)) return true;
        Intent intent = new Intent(ACTION_USB_PERMISSION);
        intent.setPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getBroadcast(context, 0, intent, flags);
        usbManager.requestPermission(device, pi);
        return true;
    }

    /** Imprime bytes ESC/POS. Bloqueante — chamar em background thread. */
    public boolean print(byte[] data) {
        UsbDevice device = findPrinterDevice();
        if (device == null) {
            lastError = "Nenhuma impressora USB encontrada";
            return false;
        }
        if (!usbManager.hasPermission(device)) {
            lastError = "Sem permissão USB";
            requestPermission();
            return false;
        }
        return printOnce(device, data);
    }

    private boolean printOnce(UsbDevice device, byte[] data) {
        UsbDeviceConnection conn = null;
        UsbInterface dataIface = null, ctrlIface = null;
        UsbEndpoint epOut = null;

        try {
            conn = usbManager.openDevice(device);
            if (conn == null) { lastError = "Falha ao abrir USB"; return false; }

            for (int i = 0; i < device.getInterfaceCount(); i++) {
                UsbInterface ifc = device.getInterface(i);
                int cls = ifc.getInterfaceClass();
                if (cls == 2) { ctrlIface = ifc; conn.claimInterface(ifc, true); }
                else if (cls == 10) { dataIface = ifc; conn.claimInterface(ifc, true); epOut = findBulkOut(ifc); }
                else if (epOut == null) { if (conn.claimInterface(ifc, true)) epOut = findBulkOut(ifc); if (epOut != null) dataIface = ifc; }
            }
            if (epOut == null) { lastError = "Sem endpoint bulk OUT"; safeClose(conn, dataIface, ctrlIface); return false; }

            int ctrlId = ctrlIface != null ? ctrlIface.getId() : 0;

            // SET_LINE_CODING: 115200 8N1
            byte[] lc = {(byte)0x00,(byte)0xC2,(byte)0x01,0x00,0x00,0x00,0x08};
            conn.controlTransfer(UsbConstants.USB_DIR_OUT | UsbConstants.USB_TYPE_CLASS, 0x20, 0, ctrlId, lc, lc.length, 3000);

            // SET_CONTROL_LINE_STATE: DTR + RTS
            conn.controlTransfer(UsbConstants.USB_DIR_OUT | UsbConstants.USB_TYPE_CLASS, 0x22, 0x03, ctrlId, null, 0, 3000);
            try { Thread.sleep(200); } catch (InterruptedException ignored) {}

            boolean ok = sendToEndpoint(conn, epOut, data);

            conn.controlTransfer(UsbConstants.USB_DIR_OUT | UsbConstants.USB_TYPE_CLASS, 0x22, 0x00, ctrlId, null, 0, 1000);
            safeClose(conn, dataIface, ctrlIface);
            if (ok) lastError = "";
            return ok;
        } catch (Exception e) {
            lastError = e.getMessage();
            Log.e(TAG, "printOnce", e);
            safeClose(conn, dataIface, ctrlIface);
            return false;
        }
    }

    private UsbEndpoint findBulkOut(UsbInterface ifc) {
        for (int j = 0; j < ifc.getEndpointCount(); j++) {
            UsbEndpoint ep = ifc.getEndpoint(j);
            if (ep.getDirection() == UsbConstants.USB_DIR_OUT && ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) return ep;
        }
        return null;
    }

    private boolean sendToEndpoint(UsbDeviceConnection conn, UsbEndpoint ep, byte[] data) {
        int chunk = ep.getMaxPacketSize() > 0 ? ep.getMaxPacketSize() : 64;
        int off = 0;
        while (off < data.length) {
            int len = Math.min(chunk, data.length - off);
            int w = conn.bulkTransfer(ep, data, off, len, 5000);
            if (w <= 0) { w = conn.bulkTransfer(ep, data, off, 1, 5000); if (w <= 0) { lastError = "Falha envio off=" + off; return false; } }
            off += w;
            if (off < data.length) try { Thread.sleep(10); } catch (InterruptedException ignored) {}
        }
        return true;
    }

    private void safeClose(UsbDeviceConnection conn, UsbInterface d, UsbInterface c) {
        if (conn == null) return;
        if (d != null) try { conn.releaseInterface(d); } catch (Exception ignored) {}
        if (c != null) try { conn.releaseInterface(c); } catch (Exception ignored) {}
        try { conn.close(); } catch (Exception ignored) {}
    }

    private boolean isPrinterDevice(UsbDevice device) {
        if (device.getDeviceClass() == UsbConstants.USB_CLASS_PRINTER) return true;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            int cls = device.getInterface(i).getInterfaceClass();
            if (cls == UsbConstants.USB_CLASS_PRINTER || cls == 10) return true;
        }
        int vid = device.getVendorId();
        return vid == 0x0b1b || vid == 0x0471 || vid == 0x0519 || vid == 0x6868;
    }
}
