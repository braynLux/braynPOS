/**
 * BRAYN Bluetooth Printer Utility
 * Uses Web Bluetooth API to connect to ESC/POS receipt printers.
 */

export interface PrinterDevice {
  device: any;
  characteristic: any;
}

// Common Bluetooth Printer Service UUIDs (including portable/mobile specific ones)
const PRINTER_SERVICES = [
  '00001101-0000-1000-8000-00805f9b34fb', // SPP (Serial Port Profile)
  '000018f0-0000-1000-8000-00805f9b34fb', // Common BLE Portable Printers
  '0000ff00-0000-1000-8000-00805f9b34fb', // Generic BLE
  '49535441-4e54-4152-444f-4d41494e5331', // ISCP
  '0000ae30-0000-1000-8000-00805f9b34fb', // Custom BLE
];

export class BluetoothPrinter {
  private static instance: PrinterDevice | null = null;

  static async connect(): Promise<PrinterDevice> {
    if (this.instance?.device.gatt?.connected) {
      return this.instance;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: PRINTER_SERVICES }, { namePrefix: 'Printer' }, { namePrefix: 'POS' }, { namePrefix: 'MP' }],
        optionalServices: PRINTER_SERVICES
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error('Could not connect to GATT server');

      // Find the first writable characteristic
      const services = await server.getPrimaryServices();
      let char: any = null;

      for (const service of services) {
        const chars = await service.getCharacteristics();
        char = chars.find((c: any) => c.properties.write || c.properties.writeWithoutResponse) || null;
        if (char) break;
      }

      if (!char) throw new Error('No writable characteristic found');

      this.instance = { device, characteristic: char };
      return this.instance;
    } catch (err) {
      console.error('[BluetoothPrinter] Connection failed:', err);
      throw err;
    }
  }

  static async print(data: Uint8Array) {
    const printer = await this.connect();
    // Split into chunks if data is large (BLE has small MTU)
    const CHUNK_SIZE = 20; 
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      await printer.characteristic.writeValue(chunk);
    }
  }

  static generateEscPos(receipt: any, settings: any): Uint8Array {
    const encoder = new TextEncoder();
    const commands: number[] = [];

    // ESC/POS Commands
    const INIT = [0x1B, 0x40];
    const CENTER = [0x1B, 0x61, 0x01];
    const LEFT = [0x1B, 0x61, 0x00];
    const BOLD_ON = [0x1B, 0x45, 0x01];
    const BOLD_OFF = [0x1B, 0x45, 0x00];
    const DOUBLE_SIZE = [0x1D, 0x21, 0x11];
    const NORMAL_SIZE = [0x1D, 0x21, 0x00];
    const CUT = [0x1D, 0x56, 0x41, 0x03];

    const is58mm = settings.paperWidth === '58mm';
    const lineWidth = is58mm ? 32 : 42;

    const addText = (text: string) => commands.push(...Array.from(encoder.encode(text + '\n')));
    const addRaw = (bytes: number[]) => commands.push(...bytes);
    const line = (char = '-') => char.repeat(lineWidth);

    addRaw(INIT);
    addRaw(CENTER);
    
    if (settings.showBusinessName !== false) {
      addRaw(DOUBLE_SIZE);
      addRaw(BOLD_ON);
      addText(receipt.channel.name);
      addRaw(NORMAL_SIZE);
      addRaw(BOLD_OFF);
    }

    if (settings.showBusinessAddress !== false && receipt.channel.address) {
      addText(receipt.channel.address);
    }
    if (settings.showBusinessPhone !== false && receipt.channel.phone) {
      addText(`TEL: ${receipt.channel.phone}`);
    }

    addText(line('-'));
    addRaw(LEFT);
    addText(`ID: ${receipt.receiptNo}`);
    addText(`Date: ${new Date(receipt.date).toLocaleString()}`);
    
    if (settings.showCashierName && receipt.cashier) {
      addText(`Cashier: ${receipt.cashier}`);
    }
    if (settings.showCustomerInfo && receipt.customer) {
      addText(`Customer: ${receipt.customer.name}`);
    }
    
    addText(line('-'));

    receipt.items.forEach((item: any) => {
      addText(`${item.name}`);
      const priceStr = item.unitPrice.toLocaleString();
      const totalStr = item.lineTotal.toLocaleString();
      const qtyLine = `${item.quantity} x ${priceStr}`;
      const padding = lineWidth - qtyLine.length - totalStr.length;
      addText(qtyLine + ' '.repeat(Math.max(1, padding)) + totalStr);
    });

    addText(line('-'));
    
    // Detailed Totals
    const addTotalRow = (label: string, value: number, bold = false) => {
      if (bold) addRaw(BOLD_ON);
      const valStr = value.toLocaleString();
      const padding = lineWidth - label.length - valStr.length;
      addText(label + ' '.repeat(Math.max(1, padding)) + valStr);
      if (bold) addRaw(BOLD_OFF);
    };

    addTotalRow('Subtotal', receipt.totals.subtotal);
    if (receipt.totals.discount) addTotalRow('Discount', -receipt.totals.discount);
    if (receipt.totals.tax) addTotalRow('Tax', receipt.totals.tax);
    
    addText(line('='));
    addTotalRow('TOTAL', receipt.totals.total, true);
    addText(line('='));

    receipt.payments.forEach((p: any) => {
      const pLabel = p.method.replace('_', ' ');
      const pVal = `${p.amount.toLocaleString()}`;
      const pPadding = lineWidth - pLabel.length - pVal.length;
      addText(pLabel + ' '.repeat(Math.max(1, pPadding)) + pVal);
    });

    addRaw(CENTER);
    if (settings.showBarcode) {
      addText('\n');
      
      // QR Code Implementation (Native ESC/POS)
      // Reference: GS ( k
      const qrData = receipt.receiptNo;
      const qrDataBytes = encoder.encode(qrData);
      const storeLen = qrDataBytes.length + 3;
      const pl = storeLen % 256;
      const ph = Math.floor(storeLen / 256);

      addRaw([
        0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // Model 2
        0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06,       // Size 6
        0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30,       // EC Level L
        0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30,            // Store data
        ...Array.from(qrDataBytes),
        0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30        // Print QR
      ]);
      
      // Secondary 1D Barcode (CODE128) for maximum compatibility
      addText('\n');
      addRaw([0x1D, 0x68, 0x40]); // Height
      addRaw([0x1D, 0x77, 0x02]); // Width
      addRaw([0x1D, 0x6B, 0x49, qrData.length]); // CODE128
      qrData.split('').forEach((c: string) => commands.push(c.charCodeAt(0)));
      addText('\n');
    }
    
    addText('\n' + (settings.receiptFooter || 'Thank you!'));
    addRaw(BOLD_ON);
    addText('POWERED BY BRAYN POS');
    addRaw(BOLD_OFF);
    addText('\n\n\n'); // Feed
    addRaw(CUT);

    return new Uint8Array(commands);
  }
}
